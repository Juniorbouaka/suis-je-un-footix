/**
 * Apparences du terrain.
 *
 * Le serveur ne connaît que les clés : le rendu est entièrement en CSS,
 * dans styles.css, sous le sélecteur [data-pitch='<clé>']. Ajouter un thème
 * demande donc deux choses — une entrée ici, un bloc de variables là-bas.
 */

export const PITCH_THEMES = [
  { key: 'classique', label: 'Classique', hint: 'Pelouse et lumière de stade', premium: false },
  { key: 'nocturne', label: 'Nocturne', hint: 'Match en nocturne, bleu profond', premium: true },
  { key: 'braise', label: 'Braise', hint: 'Coucher de soleil sur la pelouse', premium: true },
  { key: 'glace', label: 'Glace', hint: 'Terrain gelé, cyan et blanc', premium: true },
  { key: 'ocre', label: 'Terre battue', hint: 'Ocre et poussière', premium: true },
];

export const DEFAULT_THEME = 'classique';

const BY_KEY = new Map(PITCH_THEMES.map((t) => [t.key, t]));

export function findTheme(key) {
  return BY_KEY.get(key) || null;
}

/** Le thème est-il utilisable par ce compte ? */
export function canUseTheme(key, isPremium) {
  const theme = findTheme(key);
  if (!theme) return false;
  return !theme.premium || Boolean(isPremium);
}
