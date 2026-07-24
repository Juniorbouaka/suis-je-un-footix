/**
 * Présence en direct : compte les visiteurs actuellement sur le site,
 * connectés ou non. Chaque client envoie un ping toutes les 15 s ;
 * une entrée expire au bout de 40 s sans signe de vie.
 */

const TTL_MS = 40_000;
const visitors = new Map(); // id anonyme → dernier ping (ms)

export function touch(id) {
  if (!id || typeof id !== 'string' || id.length > 64) return;
  visitors.set(id, Date.now());
}

export function onlineCount() {
  const cutoff = Date.now() - TTL_MS;
  let n = 0;
  for (const [id, seen] of visitors) {
    if (seen < cutoff) visitors.delete(id);
    else n++;
  }
  return n;
}

/** Pic de fréquentation depuis le démarrage, pour donner du relief à l'accueil. */
let peak = 0;
export function peakCount() {
  peak = Math.max(peak, onlineCount());
  return peak;
}

// Nettoyage périodique pour éviter que la Map ne grossisse indéfiniment.
setInterval(() => onlineCount(), 60_000).unref?.();
