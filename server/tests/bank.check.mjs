/**
 * Verification de la banque de joueurs.
 * Usage : npm run check:bank
 * Affiche le total, la repartition par difficulte et TOUT ce qui a ete rejete
 * (accent, tiret, espace, longueur) pour que tu puisses corriger facilement.
 */
import { WORD_BANK, REJECTED, BANK_SIZE } from '../src/words.js';

const byTier = WORD_BANK.reduce((acc, w) => {
  acc[w.difficulty] = (acc[w.difficulty] || 0) + 1;
  return acc;
}, {});

console.log('\n=== BANQUE DE JOUEURS ===');
console.log('Total retenu :', BANK_SIZE);
console.log('Par difficulte :', byTier);

if (REJECTED.length) {
  console.log(`\n${REJECTED.length} entree(s) rejetee(s) :`);
  for (const r of REJECTED) console.log(`  - "${r.word}" (${r.reason})`);
} else {
  console.log('\nAucune entree rejetee.');
}

console.log('\nApercu (20 premiers) :', WORD_BANK.slice(0, 20).map((w) => w.word).join(', '));
console.log('');
