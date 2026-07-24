import crypto from 'node:crypto';
import { db } from './db.js';
import { playersFamous } from './words/players-famous.js';

/*
 * Les modules élargis (legends.js, players-world.js, players-france.js,
 * players-premier.js, players-liga-seriea.js, players-international.js,
 * players-more.js, players-final.js) totalisent 1551 noms, jusqu'aux profils
 * très pointus. Ils restent dans le dépôt : pour élargir la banque, il suffit
 * de les importer et de les ajouter à MODULES ci-dessous.
 */

/* ------------------------------------------------------------------ *
 *  Assemblage et validation de la banque de joueurs
 * ------------------------------------------------------------------ */

const MODULES = [playersFamous];

/** Un mot valide : lettres ASCII minuscules uniquement, 3 a 20 caracteres. */
const VALID = /^[a-z]{3,20}$/;

export const REJECTED = [];

function build() {
  const seen = new Map();

  for (const mod of MODULES) {
    for (const [tier, words] of Object.entries(mod.tiers)) {
      for (const raw of words) {
        const word = String(raw).toLowerCase().trim();

        if (!VALID.test(word)) {
          REJECTED.push({ word: raw, reason: 'accent, tiret, espace ou longueur' });
          continue;
        }
        if (seen.has(word)) continue; // doublon : on garde la premiere occurrence

        seen.set(word, {
          word,
          category: mod.category,
          difficulty: Number(tier),
          type: 'joueur',
        });
      }
    }
  }

  // Ordre stable, indépendant de l'ordre d'import.
  return [...seen.values()].sort((a, b) => a.word.localeCompare(b.word));
}

export const WORD_BANK = build();

/* ------------------------------------------------------------------ *
 *  Tirage du mot du jour
 *  Permutation deterministe par annee : aucun mot ne sort deux fois
 *  dans la meme annee, et la sequence est identique pour tous les joueurs.
 * ------------------------------------------------------------------ */

function seededShuffle(items, seedText) {
  const out = [...items];
  let counter = 0;
  const nextInt = (max) => {
    const hash = crypto.createHash('sha256').update(`${seedText}:${counter++}`).digest();
    return hash.readUInt32BE(0) % max;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = nextInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const scheduleCache = new Map();

function scheduleFor(year) {
  if (!scheduleCache.has(year)) {
    scheduleCache.set(year, seededShuffle(WORD_BANK, `footix::${year}`));
  }
  return scheduleCache.get(year);
}

function dayOfYear(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / 86_400_000);
}

/** Date du jour au format YYYY-MM-DD, en UTC (reinitialisation a minuit UTC). */
export function todayUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** Numero de partie : jours ecoules depuis le lancement du jeu. */
const EPOCH = Date.UTC(2026, 0, 1);
export function puzzleNumber(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`).getTime();
  return Math.max(1, Math.floor((d - EPOCH) / 86_400_000) + 1);
}

function pickForDate(dateStr) {
  const year = Number(dateStr.slice(0, 4));
  const schedule = scheduleFor(year);
  return schedule[dayOfYear(dateStr) % schedule.length];
}

/**
 * Renvoie (et persiste) le joueur du jour. Le nom ne quitte JAMAIS le serveur :
 * seuls le type, la longueur et la difficulte sont exposes.
 */
export function getDailyWord(dateStr = todayUtc()) {
  const existing = db.prepare('SELECT * FROM daily_words WHERE date = ?').get(dateStr);
  if (existing) return { ...existing };

  const pick = pickForDate(dateStr);
  db.prepare(
    'INSERT OR IGNORE INTO daily_words (date, word, category, difficulty) VALUES (?, ?, ?, ?)'
  ).run(dateStr, pick.word, pick.category, pick.difficulty);

  return { ...db.prepare('SELECT * FROM daily_words WHERE date = ?').get(dateStr) };
}

/** Vue publique : des indices, jamais la reponse. */
export function publicDailyWord(dateStr = todayUtc()) {
  const daily = getDailyWord(dateStr);
  return {
    date: daily.date,
    number: puzzleNumber(daily.date),
    // Aucun indice : ni longueur, ni difficulté, ni catégorie.
    resetsAt: `${daily.date}T23:59:59Z`,
  };
}

/** Un joueur au hasard, pour le tutoriel. */
export function randomWord() {
  return WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)];
}

export const BANK_SIZE = WORD_BANK.length;

const BANK_INDEX = new Set(WORD_BANK.map((w) => w.word));

/** Ce nom fait-il partie de notre banque de footballeurs ? */
export function isKnownPlayer(word) {
  return BANK_INDEX.has(
    String(word || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
  );
}
