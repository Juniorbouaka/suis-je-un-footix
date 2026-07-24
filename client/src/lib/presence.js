import { useEffect, useState } from 'react';
import { api } from './api.js';

const KEY = 'footix.visitor';

function visitorId() {
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

/**
 * Signale la présence du visiteur toutes les 15 s et renvoie le nombre
 * de personnes actuellement sur le site (connectées ou non).
 */
export function usePresence(intervalMs = 15_000) {
  const [online, setOnline] = useState(null);

  useEffect(() => {
    let alive = true;

    const ping = async () => {
      try {
        const { data } = await api.post('/presence', { id: visitorId() });
        if (alive) setOnline(data.online);
      } catch {
        /* silencieux : la présence n'est pas critique */
      }
    };

    ping();
    const id = setInterval(ping, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return online;
}

/** Temps restant avant le prochain joueur du jour (minuit UTC). */
export function useMidnightCountdown() {
  const [left, setLeft] = useState({ h: '00', m: '00', s: '00', totalMs: 0 });

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
      const diff = Math.max(0, next - now.getTime());
      setLeft({
        h: String(Math.floor(diff / 3_600_000)).padStart(2, '0'),
        m: String(Math.floor((diff % 3_600_000) / 60_000)).padStart(2, '0'),
        s: String(Math.floor((diff % 60_000) / 1000)).padStart(2, '0'),
        totalMs: diff,
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return left;
}
