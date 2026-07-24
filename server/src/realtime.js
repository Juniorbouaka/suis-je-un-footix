import crypto from 'node:crypto';
import { Server } from 'socket.io';
import { config } from './config.js';
import { db } from './db.js';
import { authenticateSocket } from './auth.js';
import { evaluateProximity, feedbackFor, normalizeWord, validateGuess, describePlayer } from './claude.js';
import { multiplayerScore, recordPvpResult, recordPvpDraw, readStats } from './scoring.js';
import { evaluatePvp } from './achievements.js';
import { isKnownPlayer, randomWord } from './words.js';

/* ------------------------------------------------------------------ *
 *  État en mémoire
 * ------------------------------------------------------------------ */

/** @type {Map<string, Room>} */
const rooms = new Map();
/** file d'attente de matchmaking : [{ socketId, userId, username }] */
let queue = [];
/** code d'invitation → roomId */
const invites = new Map();
/** userId → roomId (pour la reconnexion et l'anti-double-partie) */
const userRoom = new Map();

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function makeRoom(a, b) {
  const id = crypto.randomUUID();
  const room = {
    id,
    createdAt: Date.now(),
    startedAt: null,
    status: 'playing', // playing → finished
    turn: null,
    // Les DEUX joueurs cherchent le meme footballeur : c'est une course, et
    // les propositions de l'un renseignent l'autre.
    secret: randomWord().word,
    players: {
      [a.userId]: { ...a, guesses: [], found: false, connected: true },
      [b.userId]: { ...b, guesses: [], found: false, connected: true },
    },
    order: [a.userId, b.userId],
    winnerId: null,
    endReason: null,
    rematchVotes: new Set(),
    lastGuessAt: new Map(),
    turnTimer: null,
    turnDeadline: null,
    missedTurns: {},
  };
  rooms.set(id, room);
  userRoom.set(a.userId, id);
  userRoom.set(b.userId, id);
  return room;
}

function opponentOf(room, userId) {
  return room.order.find((id) => id !== userId);
}

function publicPlayer(room, userId, { reveal = false } = {}) {
  const p = room.players[userId];
  return {
    userId,
    username: p.username,
    ready: Boolean(p.secret),
    connected: p.connected,
    guesses: p.guesses,
    attempts: p.guesses.length,
    best: p.guesses.reduce((m, g) => Math.max(m, g.score), 0),
    found: p.found,
    remaining: Math.max(0, config.game.maxAttemptsPvp - p.guesses.length),
    exhausted: p.guesses.length >= config.game.maxAttemptsPvp,
  };
}

function roomState(room, { reveal = false } = {}) {
  return {
    roomId: room.id,
    status: room.status,
    turn: room.turn,
    turnMs: config.game.turnMs,
    turnDeadline: room.turnDeadline,
    startedAt: room.startedAt,
    maxAttempts: config.game.maxAttemptsPvp,
    winnerId: room.winnerId,
    endReason: room.endReason,
    // Le joueur mystere n'est devoile qu'a la fin de la partie.
    secret: reveal ? room.secret : null,
    players: room.order.map((id) => publicPlayer(room, id, { reveal })),
  };
}

function broadcast(io, room, event, payload) {
  io.to(room.id).emit(event, payload);
}

/** Coupe le chrono du tour en cours. */
function clearTurnTimer(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.turnDeadline = null;
}

/**
 * Démarre le chrono du joueur dont c'est le tour. À l'expiration, le tour
 * passe à l'adversaire. Trois tours manqués d'affilée = forfait.
 */
function startTurnTimer(io, room) {
  clearTurnTimer(room);
  if (room.status !== 'playing') return;

  const player = room.turn;
  room.turnDeadline = Date.now() + config.game.turnMs;

  room.turnTimer = setTimeout(() => {
    const live = rooms.get(room.id);
    if (!live || live.status !== 'playing' || live.turn !== player) return;

    live.missedTurns[player] = (live.missedTurns[player] || 0) + 1;
    broadcast(io, live, 'turn-timeout', {
      playerId: player,
      missed: live.missedTurns[player],
    });

    if (live.missedTurns[player] >= config.game.maxMissedTurns) {
      return finishGame(io, live, { winnerId: opponentOf(live, player), reason: 'timeout' });
    }

    const foe = opponentOf(live, player);
    const foeDone = live.players[foe].guesses.length >= config.game.maxAttemptsPvp;
    live.turn = foeDone ? player : foe;
    pushState(io, live);
    startTurnTimer(io, live);
  }, config.game.turnMs);
}

/** Donne le coup d'envoi apres le decompte affiche cote client. */
function launchGame(io, room) {
  setTimeout(() => {
    const live = rooms.get(room.id);
    if (!live || live.status !== 'playing' || live.startedAt) return;
    live.startedAt = Date.now();
    live.turn = live.order[Math.floor(Math.random() * 2)];
    broadcast(io, live, 'game-start', roomState(live));
    startTurnTimer(io, live);
  }, 3200);
}

function pushState(io, room, options) {
  broadcast(io, room, 'state', roomState(room, options));
}

/* ------------------------------------------------------------------ *
 *  Fin de partie
 * ------------------------------------------------------------------ */

function finishGame(io, room, { winnerId, reason }) {
  if (room.status === 'finished') return;
  clearTurnTimer(room);
  room.status = 'finished';
  room.winnerId = winnerId || null;
  room.endReason = reason;
  const durationMs = room.startedAt ? Date.now() - room.startedAt : 0;

  const [aId, bId] = room.order;

  try {
    // Les deux colonnes portent desormais le meme joueur mystere (hache).
    db.prepare(
      `INSERT INTO multiplay_games
        (id, player_a_id, player_b_id, player_a_secret, player_b_secret, winner_id, ended_at, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`
    ).run(room.id, aId, bId, sha(room.secret), sha(room.secret), winnerId, durationMs);

    const insertGuess = db.prepare(
      `INSERT INTO multiplay_guesses (game_id, player_id, word_guessed, opponent_secret_score, attempt_number)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const id of room.order) {
      room.players[id].guesses.forEach((g, i) => {
        insertGuess.run(room.id, id, g.word, g.score, i + 1);
      });
    }
  } catch (err) {
    console.error('[pvp] persistance échouée :', err.message);
  }

  const draw = reason === 'draw';
  const summary = {};
  for (const id of room.order) {
    const won = !draw && id === winnerId;
    const stats = readStats(id);
    const points = draw
      ? 100 // match nul : les deux repartent avec la moitié d'une victoire de base
      : multiplayerScore({
          won,
          attempts: room.players[id].guesses.length,
          durationMs,
          streak: won ? stats.pvpStreak || 0 : 0,
        });
    const nextStats = draw
      ? recordPvpDraw(id, { points })
      : recordPvpResult(id, { won, points });
    const unlocked = draw ? [] : evaluatePvp(id, { won, secretWord: room.secret });
    summary[id] = { points, won, draw, stats: nextStats, unlocked };
  }

  broadcast(io, room, 'game-over', {
    ...roomState(room, { reveal: true }),
    durationMs,
    reason,
    summary,
  });

  // La fiche du joueur mystere arrive juste apres (appel Claude, mis en cache).
  describePlayer(room.secret)
    .then((sheet) => broadcast(io, room, 'descriptions', { secret: room.secret, text: sheet.text }))
    .catch(() => {});
}

function cleanupRoom(room) {
  if (!room) return;
  clearTurnTimer(room);
  rooms.delete(room.id);
  for (const id of room.order) {
    if (userRoom.get(id) === room.id) userRoom.delete(id);
  }
  for (const [code, roomId] of invites) {
    if (roomId === room.id) invites.delete(code);
  }
}

/* ------------------------------------------------------------------ *
 *  Serveur temps réel
 * ------------------------------------------------------------------ */

export function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.clientOrigin, credentials: true },
    path: '/socket.io',
  });

  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    const user = socket.data.user;

    const currentRoom = () => {
      const roomId = userRoom.get(user.id);
      return roomId ? rooms.get(roomId) : null;
    };

    socket.emit('connected', { userId: user.id, username: user.username });

    /* ------------------------- Matchmaking ------------------------ */

    socket.on('join-matchmaking', () => {
      if (currentRoom()) return socket.emit('error-message', { error: 'Tu es déjà dans une partie.' });
      queue = queue.filter((p) => p.userId !== user.id && io.sockets.sockets.has(p.socketId));

      const waiting = queue.shift();
      if (!waiting) {
        queue.push({ socketId: socket.id, userId: user.id, username: user.username });
        socket.emit('matchmaking-waiting', { queued: true, position: queue.length });
        return;
      }

      const room = makeRoom(
        { userId: waiting.userId, username: waiting.username },
        { userId: user.id, username: user.username }
      );
      const otherSocket = io.sockets.sockets.get(waiting.socketId);
      otherSocket?.join(room.id);
      socket.join(room.id);

      broadcast(io, room, 'match-found', { ...roomState(room), countdown: 3 });
      launchGame(io, room);
    });

    socket.on('cancel-matchmaking', () => {
      queue = queue.filter((p) => p.userId !== user.id);
      socket.emit('matchmaking-cancelled', { ok: true });
    });

    /* ----------------------- Défi entre amis ---------------------- */

    socket.on('create-invite', () => {
      if (currentRoom()) return socket.emit('error-message', { error: 'Tu es déjà dans une partie.' });
      const code = crypto.randomBytes(3).toString('hex').toUpperCase();
      const pending = {
        code,
        host: { socketId: socket.id, userId: user.id, username: user.username },
      };
      invites.set(code, pending);
      socket.emit('invite-created', { code });
    });

    socket.on('join-invite', ({ code } = {}) => {
      const pending = invites.get(String(code || '').toUpperCase());
      if (!pending || !pending.host) {
        return socket.emit('error-message', { error: 'Code d’invitation invalide ou expiré.' });
      }
      if (pending.host.userId === user.id) {
        return socket.emit('error-message', { error: 'Tu ne peux pas rejoindre ta propre invitation.' });
      }
      invites.delete(pending.code);

      const room = makeRoom(
        { userId: pending.host.userId, username: pending.host.username },
        { userId: user.id, username: user.username }
      );
      io.sockets.sockets.get(pending.host.socketId)?.join(room.id);
      socket.join(room.id);
      broadcast(io, room, 'match-found', { ...roomState(room), countdown: 3 });
      launchGame(io, room);
    });

    /* -------------------------- Mot secret ------------------------ */

    // La phase « choisis ton mot secret » n'existe plus : les deux joueurs
    // cherchent le meme footballeur, tire par le serveur.
    socket.on('set-secret', () => {
      socket.emit('error-message', {
        error: 'Cette partie utilise un joueur mystère commun : pas de mot à choisir.',
      });
    });

    /* -------------------------- Proposition ----------------------- */

    socket.on('guess', async ({ word } = {}) => {
      const room = currentRoom();
      if (!room || room.status !== 'playing') {
        return socket.emit('error-message', { error: 'Aucune partie en cours.' });
      }
      if (room.turn !== user.id) {
        return socket.emit('error-message', { error: 'Ce n’est pas ton tour.' });
      }

      const now = Date.now();
      if (now - (room.lastGuessAt.get(user.id) || 0) < config.game.minGuessIntervalMs) {
        return socket.emit('error-message', { error: 'Une proposition par seconde maximum.' });
      }
      room.lastGuessAt.set(user.id, now);

      const check = validateGuess(word);
      if (!check.ok) return socket.emit('error-message', { error: check.error });

      // BUG A : le chrono doit s'arrêter dès la réception du mot, pas après
      // l'évaluation — sinon un appel Claude lent fait perdre le tour au joueur
      // qui a pourtant répondu dans les temps.
      clearTurnTimer(room);

      const opponentId = opponentOf(room, user.id);
      const target = room.secret; // le meme pour les deux joueurs

      const sheet = await describePlayer(target);
      const identity = sheet.usable ? sheet.text : null;
      const evaluation = await evaluateProximity(check.word, target, 'fr', identity);

      // BUG C : la partie a pu se terminer pendant l'appel réseau.
      const live = rooms.get(room.id);
      if (!live || live.status !== 'playing' || live.turn !== user.id) return;

      // BUG B : en mode mots-clés, seul le NOM EXACT fait gagner. Un score élevé
      // signale un lien fort (son club, sa sélection…), pas la bonne réponse.
      const found = normalizeWord(check.word) === normalizeWord(target);
      const fb = found ? { label: 'TROUVÉ !', tier: 'found' } : feedbackFor(evaluation.score);

      const entry = {
        word: check.word,
        score: evaluation.score,
        label: fb.label,
        tier: fb.tier,
        at: now,
      };
      room.players[user.id].guesses.push(entry);

      if (found) {
        room.players[user.id].found = true;
        broadcast(io, room, 'guess-result', { playerId: user.id, ...entry, found: true });
        return finishGame(io, room, { winnerId: user.id, reason: 'found' });
      }

      const cap = config.game.maxAttemptsPvp;
      const meDone = room.players[user.id].guesses.length >= cap;
      const foeDone = room.players[opponentId].guesses.length >= cap;

      broadcast(io, room, 'guess-result', { playerId: user.id, ...entry, found: false });

      if (meDone && foeDone) {
        return finishGame(io, room, { winnerId: null, reason: 'draw' });
      }

      // Le tour passe à l'adversaire, sauf s'il n'a plus de tentatives.
      room.missedTurns[user.id] = 0; // il a joué : la série de tours manqués repart à zéro
      room.turn = foeDone ? user.id : opponentId;
      pushState(io, room);
      startTurnTimer(io, room);
    });

    /* --------------------------- Abandon -------------------------- */

    socket.on('surrender', () => {
      const room = currentRoom();
      if (!room || room.status !== 'playing') return;
      finishGame(io, room, { winnerId: opponentOf(room, user.id), reason: 'surrender' });
    });

    /* ---------------------------- Chat ---------------------------- */

    socket.on('chat', ({ message } = {}) => {
      const room = currentRoom();
      if (!room) return;
      const text = String(message || '').trim().slice(0, 200);
      if (!text) return;
      broadcast(io, room, 'chat', { userId: user.id, username: user.username, message: text, at: Date.now() });
    });

    /* --------------------------- Revanche ------------------------- */

    socket.on('rematch', () => {
      const room = currentRoom();
      if (!room || room.status !== 'finished') return;
      room.rematchVotes.add(user.id);
      broadcast(io, room, 'rematch-vote', { votes: [...room.rematchVotes] });

      if (room.rematchVotes.size === 2) {
        const [aId, bId] = room.order;
        const fresh = makeRoom(
          { userId: aId, username: room.players[aId].username },
          { userId: bId, username: room.players[bId].username }
        );
        for (const id of room.order) {
          for (const s of io.sockets.sockets.values()) {
            if (s.data.user?.id === id) {
              s.leave(room.id);
              s.join(fresh.id);
            }
          }
        }
        cleanupRoom(room);
        broadcast(io, fresh, 'match-found', { ...roomState(fresh), countdown: 3 });
      }
    });

    socket.on('leave-room', () => {
      const room = currentRoom();
      if (!room) return;
      socket.leave(room.id);
      if (room.status !== 'finished') {
        finishGame(io, room, { winnerId: opponentOf(room, user.id), reason: 'left' });
      }
      cleanupRoom(room);
    });

    /* ------------------------- Déconnexion ------------------------ */

    socket.on('disconnect', () => {
      queue = queue.filter((p) => p.socketId !== socket.id);
      for (const [code, pending] of invites) {
        if (pending.host?.socketId === socket.id) invites.delete(code);
      }

      const room = currentRoom();
      if (!room) return;
      room.players[user.id].connected = false;

      if (room.status === 'finished') {
        cleanupRoom(room);
        return;
      }

      // Laisse 20 s pour se reconnecter avant de déclarer forfait.
      setTimeout(() => {
        const still = rooms.get(room.id);
        if (!still || still.status === 'finished') return;
        if (still.players[user.id].connected) return;
        finishGame(io, still, { winnerId: opponentOf(still, user.id), reason: 'disconnect' });
        cleanupRoom(still);
      }, 20_000);

      pushState(io, room);
    });

    /* ------------------------- Reconnexion ------------------------ */

    socket.on('resume', () => {
      const room = currentRoom();
      if (!room) return socket.emit('no-room', {});
      room.players[user.id].connected = true;
      socket.join(room.id);
      socket.emit('state', roomState(room, { reveal: room.status === 'finished' }));
    });
  });

  return io;
}

export function onlineCount(io) {
  return io ? io.sockets.sockets.size : 0;
}
