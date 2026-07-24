/**
 * Duel : les deux joueurs cherchent LE MÊME footballeur.
 * Chacun envoie des mots-clés à son tour, voit ceux de l'autre, et le premier
 * qui nomme le joueur gagne. Bob laisse volontairement filer un tour pour
 * éprouver le chrono de 15 s.
 *
 * Usage : npm run test:duel   (le serveur doit tourner)
 */
import { io } from 'socket.io-client';

const API = process.env.API_URL || 'http://localhost:4000';
const stamp = Date.now();
const t0 = Date.now();

const clock = () => `${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(5)}s`;
const log = (tag, msg) => console.log(`${clock()} [${tag.padEnd(7)}] ${msg}`);

async function register(username) {
  const res = await fetch(`${API}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: `${username}${stamp}`.slice(0, 20),
      email: `${username}${stamp}@example.com`,
      password: 'motdepasse123',
    }),
  });
  if (!res.ok) throw new Error(`signup ${username}: ${res.status} ${await res.text()}`);
  return res.json();
}

function connect(token, tag) {
  return new Promise((resolve, reject) => {
    const socket = io(API, { auth: { token }, transports: ['websocket'] });
    socket.on('connect_error', (e) => reject(new Error(`${tag}: ${e.message}`)));
    socket.on('connected', (info) => {
      socket.userId = info.userId;
      socket.tag = tag;
      resolve(socket);
    });
  });
}

const a = await register('alice');
const b = await register('bob');
const sa = await connect(a.accessToken, 'ALICE');
const sb = await connect(b.accessToken, 'BOB');

console.log('\n══════ DUEL : même joueur mystère pour Alice et Bob ══════\n');

// Mots-clés joués à tour de rôle. Les deux visent la même cible : chacun
// profite des indices de l'autre.
const PLAN = {
  ALICE: ['gardien', 'attaquant', 'france', 'bresil', 'italie', 'angleterre', 'milieu', 'defenseur'],
  BOB: ['ballon dor', 'juventus', 'barcelone', 'real madrid', 'annees 2000', 'liverpool', 'buteur', 'legende'],
};

const cursor = { ALICE: 0, BOB: 0 };
let bobSkipped = false;
const results = {};
let done;
const finished = new Promise((r) => (done = r));

for (const socket of [sa, sb]) {
  const tag = socket.tag;

  socket.on('error-message', ({ error }) => log(tag, `ERREUR : ${error}`));

  socket.on('match-found', () => log(tag, 'adversaire trouvé — décompte…'));

  socket.on('game-start', (state) => {
    if (tag === 'ALICE') {
      console.log('');
      log('ARBITRE', `coup d'envoi — ${state.turnMs / 1000}s par tour, ${state.maxAttempts} essais chacun`);
      log('ARBITRE', `joueur mystère caché : ${state.secret === null ? 'oui (non révélé)' : 'FUITE !'}\n`);
    }
    if (state.turn === socket.userId) play(tag, socket);
  });

  // Chacun voit TOUTES les propositions, y compris celles de l'adversaire.
  socket.on('guess-result', (r) => {
    if (tag !== 'ALICE') return;
    const who = r.playerId === sa.userId ? 'alice' : 'bob';
    const bar = '█'.repeat(Math.round(r.score / 10)).padEnd(10, '·');
    console.log(`${clock()} [${who.padEnd(7)}] « ${r.word.padEnd(14)} » ${bar} ${String(r.score).padStart(3)}  ${r.label}`);
  });

  socket.on('turn-timeout', ({ playerId, missed }) => {
    if (playerId !== socket.userId) return;
    log(tag, `TOUR PERDU (${missed}/3)`);
  });

  socket.on('state', (state) => {
    if (state.status === 'playing' && state.turn === socket.userId) play(tag, socket);
  });

  socket.on('descriptions', (payload) => {
    if (tag !== 'ALICE') return;
    console.log(`\n--- fiche ---\n  ${payload.secret} : ${payload.text.slice(0, 130)}…`);
  });

  socket.on('game-over', (payload) => {
    results[tag] = payload;
    if (results.ALICE && results.BOB) done();
  });
}

const playing = { ALICE: false, BOB: false };

function play(tag, socket) {
  if (playing[tag]) return;
  playing[tag] = true;

  if (tag === 'BOB' && !bobSkipped) {
    bobSkipped = true;
    log('BOB', 'hésite… (il laisse filer ce tour)');
    setTimeout(() => {
      playing[tag] = false;
    }, 16_500);
    return;
  }

  const word = PLAN[tag][cursor[tag]++];
  if (!word) {
    playing[tag] = false;
    return;
  }
  setTimeout(() => {
    playing[tag] = false;
    socket.emit('guess', { word });
  }, 1200);
}

sa.emit('join-matchmaking');
setTimeout(() => sb.emit('join-matchmaking'), 400);

const timeout = setTimeout(() => {
  console.error('\n⨯ TIMEOUT : partie non terminée en 240 s');
  process.exit(1);
}, 240_000);

await finished;
await new Promise((r) => setTimeout(r, 6000)); // laisse arriver la fiche
clearTimeout(timeout);

const final = results.ALICE;
const clean = (u) => String(u || '').replace(/\d+$/, '');
const winner = final.players.find((p) => p.userId === final.winnerId);

console.log('\n══════ RÉSULTAT ══════');
console.log('Joueur mystère :', final.secret);
console.log('Issue          :', final.reason === 'draw' ? 'match nul' : `victoire de ${clean(winner?.username)}`);
console.log('Motif          :', final.reason);
console.log('Durée          :', Math.round(final.durationMs / 1000), 's');
for (const p of final.players) {
  console.log(
    `  ${clean(p.username).padEnd(6)} ${String(p.attempts).padStart(2)} essai(s)  ` +
      `meilleur ${String(p.best).padStart(3)}  +${final.summary[p.userId]?.points} pts`
  );
}
console.log('');

sa.close();
sb.close();
process.exit(0);
