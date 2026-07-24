import { useEffect, useRef, useState } from 'react';

const TIERS = [
  { min: 86, tier: 'blazing', label: 'Brûlant !' },
  { min: 71, tier: 'hot', label: 'Très proche' },
  { min: 41, tier: 'warm', label: 'Tu te rapproches' },
  { min: 16, tier: 'cool', label: 'Loin' },
  { min: 0, tier: 'cold', label: 'Très loin' },
];

export function tierOf(score) {
  return TIERS.find((t) => score >= t.min) || TIERS.at(-1);
}

/**
 * Jauge de proximité 0–100 avec dégradé rouge → vert,
 * animation de remplissage et pulsation au résultat.
 */
export default function Gauge({ score = null, label, tier, explanation, pending = false }) {
  const [displayed, setDisplayed] = useState(0);
  const [pulse, setPulse] = useState(false);
  const raf = useRef(null);

  useEffect(() => {
    if (score == null) {
      setDisplayed(0);
      return;
    }
    const from = displayed;
    const to = score;
    const start = performance.now();
    const duration = 750;

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayed(Math.round(from + (to - from) * eased));
      if (t < 1) raf.current = requestAnimationFrame(step);
    };

    raf.current = requestAnimationFrame(step);
    setPulse(true);
    const timer = setTimeout(() => setPulse(false), 600);

    return () => {
      cancelAnimationFrame(raf.current);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score]);

  const meta = tierOf(displayed);
  const resolvedTier = score == null ? 'cold' : tier || meta.tier;
  const resolvedLabel = score == null ? '—' : label || meta.label;

  return (
    <div className={`gauge${pulse ? ' gauge-pulse' : ''}`}>
      <div className="gauge-head">
        <span className={`gauge-value tier-${resolvedTier}`}>
          {pending ? '···' : score == null ? '––' : displayed}
        </span>
        <span className={`gauge-label tier-${resolvedTier}`}>{pending ? 'Analyse…' : resolvedLabel}</span>
      </div>

      <div className="gauge-track" style={{ '--empty': 1 - displayed / 100 }}>
        {score != null && (
          <span
            className={`gauge-cursor tier-${resolvedTier}`}
            style={{ left: `${Math.max(2, Math.min(98, displayed))}%` }}
          />
        )}
      </div>

      <div className="gauge-scale">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100</span>
      </div>

      <p className="gauge-explanation">{explanation || ''}</p>
    </div>
  );
}
