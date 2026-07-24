/**
 * Duel complet, joué par deux clients réels.
 * Alice pense à ZIDANE, Bob pense à BUFFON. Chacun envoie des mots-clés.
 * Bob laisse volontairement filer un tour pour éprouver le chrono de 15 s.
 *
 * Usage : npm run test:duel   (le serveur doit tourner)
 */
import { io } from 'socket.io-client';

const API = 'http://localhost:4000';
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

console.log('\n══════════ DUEL : Alice vs Bob ══════════\n');

/* Alice cherche le secret de Bob (buffon), Bob cherche celui d'Alice (zidane). */
const PLAN = {
  ALICE: ['gardien', 'italie', 'juventus', 'buffon'],
  BOB: ['milieu', 'france', 'coupe du monde', 'zidane'],
};
const SECRETS = { ALICE: 'zidane', BOB: 'buffon' };

const cursor = { ALICE: 0, BOB: 0 };
let bobSkipped = false;
const results = {};
let done;
const finished = new Promise((r) => (done = r));

for (const socket of [sa, sb]) {
  const tag = socket.tag;

  socket.on('error-message', ({ error }) => log(tag, `ERREUR : ${error}`));

  socket.on('match-found', () => {
    log(tag, `adversaire trouvé — secret choisi : « ${SECRETS[tag]} »`);
    socket.emit('set-secret', { word: SECRETS[tag] });
  });

  socket.on('game-start', (state) => {
    if (tag === 'ALICE') {
      console.log('');
      log('ARBITRE', `coup d'envoi — ${state.turnMs / 1000}s par tour, ${state.maxAttempts} essais max\n`);
    }
    if (state.turn === socket.userId) play(tag, socket);
  });

  socket.on('guess-result', (r) => {
    if (r.playerId !== socket.userId) return;
    const bar = '█'.repeat(Math.round(r.score / 10)).padEnd(10, '·');
    log(tag, `« ${r.word.padEnd(14)} » ${bar} ${String(r.score).padStart(3)}  ${r.label}`);
  });

  socket.on('turn-timeout', ({ playerId, missed }) => {
    if (playerId !== socket.userId) return;
    log(tag, `TOUR PERDU (${missed}/3) — la main passe à l'adversaire`);
  });

  socket.on('state', (state) => {
    if (state.status === 'playing' && state.turn === socket.userId) play(tag, socket);
  });

  socket.on('descriptions', (payload) => {
    if (tag !== 'ALICE') return;
    console.log('\n--- fiches révélées ---');
    for (const [id, text] of Object.entries(payload)) {
      const who = results.ALICE?.players.find((p) => p.userId === id);
      console.log(`  ${who?.secret ?? id} : ${text.slice(0, 120)}…`);
    }
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

  // Bob laisse volontairement expirer son premier tour.
  if (tag === 'BOB' && !bobSkipped) {
    bobSkipped = true;
    log('BOB', 'hésite… (il ne répondra pas à temps)');
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
  }, 1500);
}

sa.emit('join-matchmaking');
setTimeout(() => sb.emit('join-matchmaking'), 400);

const timeout = setTimeout(() => {
  console.error('\n⨯ TIMEOUT : la partie ne s’est pas terminée en 150 s');
  process.exit(1);
}, 150_000);

await finished;
// laisse arriver l'événement `descriptions`, émis juste après game-over
await new Promise((r) => setTimeout(r, 6000));
clearTimeout(timeout);

const final = results.ALICE;
const clean = (u) => String(u || '').replace(/\d+$/, '');
const winner = final.players.find((p) => p.userId === final.winnerId);

console.log('\n══════════ RÉSULTAT ══════════');
console.log('Issue   :', final.reason === 'draw' ? 'match nul' : `victoire de ${clean(winner?.username)}`);
console.log('Motif   :', final.reason);
console.log('Durée   :', Math.round(final.durationMs / 1000), 's');
for (const p of final.players) {
  const pts = final.summary[p.userId]?.points;
  console.log(
    `  ${clean(p.username).padEnd(6)} secret « ${String(p.secret).padEnd(8)} »  ` +
      `${String(p.attempts).padStart(2)} essai(s)  meilleur ${String(p.best).padStart(3)}  +${pts} pts`
  );
}
console.log('');

sa.close();
sb.close();
process.exit(0);
