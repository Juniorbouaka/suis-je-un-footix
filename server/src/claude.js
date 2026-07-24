import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { db } from './db.js';
import { hasBudget, consume } from './budget.js';
import { isKnownPlayer } from './words.js';

/* ------------------------------------------------------------------ *
 *  Client Anthropic (optionnel : sans clé, on bascule sur le fallback)
 * ------------------------------------------------------------------ */

const client = config.claude.apiKey
  ? new Anthropic({ apiKey: config.claude.apiKey, timeout: config.claude.timeoutMs })
  : null;

export const claudeEnabled = Boolean(client);

/**
 * Tous les modèles n'acceptent pas `output_config.effort` :
 * Haiku 4.5 et Sonnet 4.5 renvoient une 400. On ne l'envoie donc
 * qu'aux modèles qui le supportent.
 */
const SUPPORTS_EFFORT = /(opus-4-(5|6|7|8)|sonnet-(5|4-6)|fable|mythos)/.test(config.claude.model);

function outputConfig(format) {
  return SUPPORTS_EFFORT ? { effort: 'low', format } : { format };
}

/* ------------------------------------------------------------------ *
 *  Normalisation & modération
 * ------------------------------------------------------------------ */

export function normalizeWord(word) {
  return String(word || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9'\- ]/g, '')
    .trim();
}

const BLOCKLIST = new Set([
  'connard', 'salope', 'enculer', 'enculé', 'pute', 'nique', 'niquer',
  'fdp', 'ntm', 'batard', 'bâtard', 'pd', 'negre', 'nègre', 'bougnoule',
]);

export function isOffensive(word) {
  return BLOCKLIST.has(normalizeWord(word));
}

export function validateGuess(raw) {
  const word = String(raw || '').trim();
  if (!word) return { ok: false, error: 'Entre un mot.' };
  if (word.length > 40) return { ok: false, error: 'Mot trop long (40 caractères max).' };
  if (!/^[\p{L}\p{M}'\- ]+$/u.test(word)) {
    return { ok: false, error: 'Lettres, tirets et apostrophes uniquement.' };
  }
  if (word.split(/\s+/).length > 3) return { ok: false, error: 'Trois mots maximum.' };
  if (isOffensive(word)) return { ok: false, error: 'Ce mot n’est pas accepté.' };
  return { ok: true, word };
}

/* ------------------------------------------------------------------ *
 *  Feedback textuel & couleurs (cahier des charges §3.1)
 * ------------------------------------------------------------------ */

export function feedbackFor(score) {
  if (score >= 86) return { label: 'Brûlant !', tier: 'blazing' };
  if (score >= 71) return { label: 'Très proche', tier: 'hot' };
  if (score >= 41) return { label: 'Tu te rapproches', tier: 'warm' };
  if (score >= 16) return { label: 'Loin', tier: 'cool' };
  return { label: 'Très loin', tier: 'cold' };
}

/* ------------------------------------------------------------------ *
 *  Cache de proximité (SQLite, joue le rôle du cache Redis du CDC)
 * ------------------------------------------------------------------ */

/**
 * Version du prompt d'évaluation. À incrémenter à CHAQUE modification de
 * SYSTEM_PROMPT : la clé de cache en dépend, donc les anciens scores
 * (calculés avec l'ancien barème) sont automatiquement ignorés.
 */
const PROMPT_VERSION = 3;

function cacheKey(a, b, language) {
  const [x, y] = [normalizeWord(a), normalizeWord(b)].sort();
  // Le modèle fait partie de la clé : changer de modèle n'hérite pas des
  // scores de l'ancien, et revenir en arrière retrouve son cache intact.
  return `v${PROMPT_VERSION}:${config.claude.model}:${language}:${x}|${y}`;
}

function readCache(key) {
  const row = db.prepare('SELECT score, explanation, source FROM proximity_cache WHERE key = ?').get(key);
  return row ? { ...row, cached: true } : null;
}

function writeCache(key, { score, explanation, source }) {
  db.prepare(
    `INSERT INTO proximity_cache (key, score, explanation, source) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET score = excluded.score,
                                    explanation = excluded.explanation,
                                    source = excluded.source`
  ).run(key, score, explanation, source);
}

/* ------------------------------------------------------------------ *
 *  Évaluateur de secours (aucune clé API / panne / timeout)
 * ------------------------------------------------------------------ */

function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/**
 * Similarité de Dice sur les bigrammes + bonus de préfixe partagé.
 * Ce n'est PAS de la sémantique : c'est un filet de sécurité pour que le jeu
 * reste jouable si Claude est indisponible.
 */
function fallbackEvaluate(userWord, secretWord) {
  const a = normalizeWord(userWord);
  const b = normalizeWord(secretWord);
  if (a === b) return { score: 100, explanation: 'Mot identique.', source: 'fallback' };

  const A = bigrams(a);
  const B = bigrams(b);
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  const dice = (A.size + B.size) === 0 ? 0 : (2 * shared) / (A.size + B.size);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  const prefixBonus = Math.min(prefix, 5) * 2;

  const score = Math.max(0, Math.min(78, Math.round(dice * 70 + prefixBonus)));
  return {
    score,
    explanation: 'Évaluation approximative (service sémantique indisponible).',
    source: 'fallback',
  };
}

/* ------------------------------------------------------------------ *
 *  Évaluation sémantique via Claude
 * ------------------------------------------------------------------ */

export const SYSTEM_PROMPT = `Tu es un expert du football mondial. Il y a un JOUEUR MYSTÈRE, identifié sans ambiguïté par le champ "secret_word_identity". Le joueur propose un MOT ("user_word") : ce peut être un nom de footballeur, un club, un pays, un poste, un trophée, une compétition, un surnom, une qualité, un fait marquant — n'importe quoi.

Ta tâche : noter de 0 à 100 la FORCE DU LIEN entre ce mot et le joueur mystère.

Barème :
100    : le mot est exactement le nom du joueur mystère
85–99  : lien direct et central — son club emblématique, sa sélection, son poste exact, le trophée qui l'a défini, son surnom
70–84  : lien fort — un club où il a réellement joué, un coéquipier marquant, sa génération et son poste, un trait de jeu caractéristique
50–69  : lien réel mais secondaire — sa nationalité seule, un joueur du même poste à la même époque, une compétition qu'il a disputée
30–49  : lien lointain — même sport et même époque, rien de spécifique
10–29  : rapport très ténu — football en général, ou un joueur sans point commun
0–9    : aucun rapport avec ce joueur

Règles :
- L'orthographe ne compte JAMAIS. Deux noms qui se ressemblent (« gomis » / « gomes ») désignent des personnes différentes : juge le sens, pas les lettres.
- Un nom de joueur peu médiatisé reste un footballeur : compare-le sur ses caractéristiques réelles, ne le traite pas comme un mot ordinaire.
- Fie-toi à "secret_word_identity" plutôt qu'à ta propre interprétation du nom du joueur mystère.
- Sois exigeant sur le haut du barème : réserve 85+ à ce qui identifie vraiment ce joueur et lui seul.
- L'explication fait UNE phrase courte, en français. Elle dit pourquoi le lien est fort ou faible SANS JAMAIS nommer le joueur mystère, son club principal, sa nationalité ni son poste. Reste vague sur ce qu'il est : ne donne aucun indice exploitable.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer' },
    explanation: { type: 'string' },
  },
  required: ['score', 'explanation'],
  additionalProperties: false,
};

function supportsEffort(model) {
  return /(opus-4-(5|6|7|8)|sonnet-(5|4-6)|fable|mythos)/.test(model);
}

async function claudeEvaluate(userWord, secretWord, language, model = config.claude.model, secretContext = null) {
  const payload = { user_word: userWord, secret_word: secretWord, language };
  if (secretContext) {
    // Lève l'ambiguïté des homonymes : « Foster » désigne plusieurs joueurs.
    payload.secret_word_identity = secretContext;
  }

  const response = await client.messages.create({
    model,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    output_config: supportsEffort(model)
      ? { effort: 'low', format: { type: 'json_schema', schema: RESPONSE_SCHEMA } }
      : { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Réponse refusée par le modèle.');
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Réponse vide du modèle.');

  const parsed = JSON.parse(textBlock.text);
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
  if (!Number.isFinite(score)) throw new Error('Score invalide.');

  return {
    score,
    explanation: String(parsed.explanation || '').slice(0, 300),
    source: 'claude',
    model,
  };
}

/**
 * Escalade : les petits modèles ne connaissent pas les joueurs moins médiatisés
 * et leur collent un score proche de zéro (« nom non identifié »). Quand un score
 * très bas tombe alors que les DEUX noms figurent dans notre banque — donc sont
 * bel et bien des footballeurs — on refait l'évaluation avec un modèle plus fort.
 * Cela ne concerne qu'une petite fraction des appels : le coût reste celui du
 * petit modèle, la qualité celle du grand.
 */
function needsEscalation(score, userWord, secretWord) {
  if (config.claude.model === config.claude.escalationModel) return false;
  if (score >= config.claude.escalationBelow) return false;
  return isKnownPlayer(userWord) && isKnownPlayer(secretWord);
}

/* ------------------------------------------------------------------ *
 *  Fiche du joueur, affichée une fois le nom trouvé
 * ------------------------------------------------------------------ */

const DESCRIBE_SYSTEM = `Tu rédiges des mini-fiches de footballeurs pour un jeu de quiz français.

On te donne un NOM DE FAMILLE. Identifie le footballeur professionnel le plus connu portant ce nom
et rédige 2 phrases courtes, factuelles et vivantes : prénom et nom complet, poste, nationalité,
période d'activité, clubs marquants, et un fait qui le rend mémorable (titre, record, geste).

Si le nom peut désigner plusieurs joueurs, prends le plus célèbre.
Si tu n'identifies aucun footballeur, réponds exactement : "Joueur non identifié."
Pas de liste, pas de markdown, pas de superlatifs creux.`;

const DESCRIBE_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    identified: { type: 'boolean' },
  },
  required: ['description', 'identified'],
  additionalProperties: false,
};

function readDescription(word) {
  const row = db.prepare('SELECT text, source FROM word_descriptions WHERE word = ?').get(word);
  return row ? { ...row } : null;
}

/**
 * Renvoie une courte fiche sur le joueur trouvé. Résultat mis en cache : une
 * même vedette n'est décrite qu'une seule fois, quel que soit le nombre de joueurs.
 */
export async function describePlayer(word) {
  const key = normalizeWord(word);
  const cached = readDescription(key);
  if (cached && cached.source === 'claude') {
    return { text: cached.text, source: 'claude', cached: true, usable: true };
  }

  if (client && hasBudget()) {
    try {
      consume();
      const response = await client.messages.create({
        model: config.claude.model,
        max_tokens: 400,
        system: DESCRIBE_SYSTEM,
        output_config: outputConfig({ type: 'json_schema', schema: DESCRIBE_SCHEMA }),
        messages: [{ role: 'user', content: `Nom de famille : ${word}` }],
      });

      if (response.stop_reason !== 'refusal') {
        const block = response.content.find((b) => b.type === 'text');
        if (block) {
          const parsed = JSON.parse(block.text);
          const text = String(parsed.description || '').trim().slice(0, 500);
          if (text) {
            db.prepare(
              `INSERT INTO word_descriptions (word, text, source) VALUES (?, ?, 'claude')
               ON CONFLICT(word) DO UPDATE SET text = excluded.text, source = 'claude'`
            ).run(key, text);
            return { text, source: 'claude', cached: false, usable: true };
          }
        }
      }
    } catch (err) {
      console.warn('[claude] fiche joueur indisponible →', err.message);
    }
  }

  if (cached) return { text: cached.text, source: cached.source, cached: true };

  return {
    text: "Fiche indisponible : configure ANTHROPIC_API_KEY pour afficher la biographie du joueur.",
    source: 'fallback',
    cached: false,
    usable: false, // ne jamais utiliser ce texte comme contexte d'évaluation
  };
}

/**
 * Point d'entrée unique : renvoie { score, explanation, source, cached }.
 * Ne lève jamais — bascule sur l'évaluateur de secours en cas de problème.
 */
export async function evaluateProximity(userWord, secretWord, language = 'fr', secretContext = null) {
  const a = normalizeWord(userWord);
  const b = normalizeWord(secretWord);

  if (!a) return { score: 0, explanation: 'Mot vide.', source: 'local', cached: false };
  if (a === b) {
    return { score: 100, explanation: 'C’est exactement le joueur !', source: 'local', cached: false };
  }

  const key = cacheKey(a, b, language);
  const hit = readCache(key);
  if (hit && hit.source === 'claude') return hit;

  if (client && hasBudget()) {
    try {
      consume();
      let result = await claudeEvaluate(userWord, secretWord, language, config.claude.model, secretContext);

      if (needsEscalation(result.score, userWord, secretWord) && hasBudget()) {
        consume();
        const stronger = await claudeEvaluate(
          userWord,
          secretWord,
          language,
          config.claude.escalationModel,
          secretContext
        );
        console.log(
          `[claude] escalade ${userWord}/${secretWord} : ${result.score} → ${stronger.score}`
        );
        result = { ...stronger, escalated: true };
      }

      writeCache(key, result);
      return { ...result, cached: false };
    } catch (err) {
      console.warn('[claude] évaluation indisponible →', err.message);
    }
  }

  if (hit) return hit;
  const fallback = fallbackEvaluate(userWord, secretWord);
  writeCache(key, fallback);
  return { ...fallback, cached: false };
}
