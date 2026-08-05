import { db } from './db.js';
import { normalizeWord, isOffensive } from './claude.js';

/**
 * Les soutiens.
 *
 * Est « soutien » tout compte rattaché à au moins un don encaissé. Le statut
 * ne s'achète pas plus qu'il ne se perd : contrairement au premium, il n'a
 * pas d'échéance — un merci ne s'annule pas.
 *
 * Comme le badge premium, il est strictement décoratif et n'entre dans
 * aucune règle de jeu ni aucun tri.
 */

export function isSupporter(userId) {
  if (!userId) return false;
  return Boolean(
    db
      .prepare("SELECT 1 FROM donations WHERE user_id = ? AND status = 'COMPLETED' LIMIT 1")
      .get(userId)
  );
}

/**
 * Ensemble des comptes soutiens.
 * Une seule requête, pour éviter d'en lancer une par ligne de classement.
 */
export function supporterIds() {
  const rows = db
    .prepare("SELECT DISTINCT user_id FROM donations WHERE status = 'COMPLETED' AND user_id IS NOT NULL")
    .all();
  return new Set(rows.map((r) => r.user_id));
}

/* ------------------------------------------------------------------ *
 *  Le mur
 * ------------------------------------------------------------------ */

const NOM_MAX = 24;

/**
 * Valide un nom destiné au mur.
 *
 * `isOffensive` ne teste qu'un mot entier : un pseudo peut en contenir
 * plusieurs, on vérifie donc chaque morceau. Un mur public sans filtre
 * finit toujours par accueillir ce qu'on n'y voulait pas.
 */
export function validerNom(brut) {
  const nom = String(brut || '').trim().replace(/\s+/g, ' ');

  if (!nom) return { ok: false, error: 'Entre un nom.' };
  if (nom.length > NOM_MAX) return { ok: false, error: `${NOM_MAX} caractères maximum.` };
  if (!/^[\p{L}\p{M}\p{N}'’\- .]+$/u.test(nom)) {
    return { ok: false, error: 'Lettres, chiffres, tirets et apostrophes uniquement.' };
  }
  if (nom.split(' ').some((mot) => isOffensive(mot))) {
    return { ok: false, error: 'Ce nom n’est pas accepté.' };
  }
  // Empêche de se faire passer pour le jeu lui-même.
  if (/footix|admin|moderateur|moderator/.test(normalizeWord(nom.replace(/\s/g, '')))) {
    return { ok: false, error: 'Ce nom est réservé.' };
  }

  return { ok: true, nom };
}

/** Les soutiens ayant accepté d'apparaître. Ni montants, ni dates précises. */
export function mur(limite = 200) {
  return db
    .prepare(
      `SELECT display_name AS name, captured_at AS at
         FROM donations
        WHERE status = 'COMPLETED' AND is_public = 1 AND display_name IS NOT NULL
        ORDER BY captured_at DESC
        LIMIT ?`
    )
    .all(limite)
    .map((r) => ({ name: r.name, at: r.at ? r.at.slice(0, 7) : null }));
}
