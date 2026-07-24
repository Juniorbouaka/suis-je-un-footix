/**
 * Vérifie le fonctionnement de l'escalade : Haiku évalue, et si le score est
 * anormalement bas alors que les deux noms sont dans la banque, on repasse
 * automatiquement sur un modèle plus fort.
 */
import { evaluateProximity } from '../src/claude.js';
import { config } from '../src/config.js';

console.log(`\nModèle principal : ${config.claude.model}`);
console.log(`Escalade vers    : ${config.claude.escalationModel} (si score < ${config.claude.escalationBelow})\n`);

const CASES = [
  ['foster', 'buffon', 'deux gardiens — Haiku ne connait pas Foster'],
  ['messi', 'ronaldo', 'les deux GOAT'],
  ['buffon', 'casillas', 'gardiens legendaires'],
  ['gomis', 'gomes', 'orthographe proche, joueurs differents'],
  ['pizza', 'buffon', 'un nom qui n est pas un joueur : pas d escalade'],
];

for (const [a, b, note] of CASES) {
  const t0 = Date.now();
  const r = await evaluateProximity(a, b, 'fr');
  console.log(
    `${(a + ' / ' + b).padEnd(22)} ${String(r.score).padStart(3)}  ` +
      `${r.escalated ? 'ESCALADE ' : '         '}${String(Date.now() - t0).padStart(5)}ms  ${note}`
  );
  console.log(`${''.padEnd(22)}      ${r.explanation.slice(0, 92)}`);
}
console.log('');
