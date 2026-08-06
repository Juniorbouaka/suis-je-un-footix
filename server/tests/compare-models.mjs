/**
 * Compare la qualité d'évaluation entre modèles sur des paires de footballeurs.
 * Usage : node tests/compare-models.mjs
 * Coût : quelques centimes.
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from '../src/claude.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODELS = ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'];

const SYSTEM = SYSTEM_PROMPT;

const SCHEMA = {
  type: 'object',
  properties: { score: { type: 'integer' }, explanation: { type: 'string' } },
  required: ['score', 'explanation'],
  additionalProperties: false,
};

/** [proposition, secret, attendu] */
const CASES = [
  ['platini', 'zidane', 'haut — meneurs francais legendaires'],
  ['buffon', 'casillas', 'haut — gardiens legendaires meme epoque'],
  ['messi', 'ronaldo', 'haut — les deux GOAT'],
  ['messi', 'buffon', 'bas — attaquant vs gardien'],
  ['foster', 'buffon', 'moyen — deux gardiens, notoriete tres differente'],
  ['zidane', 'beckham', 'moyen-haut — milieux stars meme epoque'],
  ['gomis', 'gomes', 'bas — orthographe proche, joueurs differents'],
  ['mbappe', 'haaland', 'haut — jeunes buteurs stars actuels'],
];

async function evaluate(model, a, b) {
  const t0 = Date.now();
  const res = await client.messages.create({
    model,
    max_tokens: 400,
    system: SYSTEM,
    output_config: /(opus-4-(5|6|7|8)|sonnet-(5|4-6)|fable)/.test(model)
      ? { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } }
      : { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: JSON.stringify({ user_word: a, secret_word: b, language: 'fr' }) }],
  });
  const text = res.content.find((c) => c.type === 'text')?.text || '{}';
  const parsed = JSON.parse(text);
  return {
    score: parsed.score,
    explanation: parsed.explanation,
    ms: Date.now() - t0,
    usage: res.usage,
  };
}

const totals = {};

for (const [a, b, attendu] of CASES) {
  console.log(`\n${a}  vs  ${b}   (${attendu})`);
  for (const model of MODELS) {
    try {
      const r = await evaluate(model, a, b);
      totals[model] ??= { ms: 0, in: 0, out: 0, n: 0 };
      totals[model].ms += r.ms;
      totals[model].in += r.usage.input_tokens;
      totals[model].out += r.usage.output_tokens;
      totals[model].n++;
      console.log(
        `   ${model.padEnd(20)} ${String(r.score).padStart(3)}  ${String(r.ms).padStart(5)}ms  ${r.explanation.slice(0, 78)}`
      );
    } catch (err) {
      console.log(`   ${model.padEnd(20)} ERREUR: ${err.message}`);
    }
  }
}

/*
 * Dollars par million de jetons, [entrée, sortie].
 *
 * Attention à Sonnet 5 : 2 / 10 est un tarif de lancement qui court jusqu'au
 * 31 août 2026. Ensuite ce sera 3 / 15, soit la moitié en plus sur la ligne
 * « $ / 1000 propositions » affichée en bas. À corriger le jour venu, sinon
 * ce banc d'essai annoncera un coût qui n'existe plus.
 */
const PRICE = {
  'claude-opus-4-8': [5, 25],
  'claude-sonnet-5': [2, 10], // 3 / 15 après le 31/08/2026
  'claude-haiku-4-5': [1, 5],
};

console.log('\n=== MOYENNES ===');
for (const [model, t] of Object.entries(totals)) {
  const [pin, pout] = PRICE[model];
  const cost = (t.in / t.n / 1e6) * pin + (t.out / t.n / 1e6) * pout;
  console.log(
    `${model.padEnd(20)} latence ${Math.round(t.ms / t.n)}ms   ` +
      `${Math.round(t.in / t.n)} tok in / ${Math.round(t.out / t.n)} tok out   ` +
      `${(cost * 1000).toFixed(2)} $ / 1000 propositions`
  );
}
console.log('');
