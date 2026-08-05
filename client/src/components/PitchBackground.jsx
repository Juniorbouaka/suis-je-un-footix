import { useMemo } from 'react';

/**
 * Décor de fond : pelouse tondue, lignes de terrain, ballons qui flottent
 * et halos lumineux. Purement décoratif, non interactif.
 */
export default function PitchBackground() {
  const floaters = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => ({
        left: `${6 + ((i * 11.5) % 92)}%`,
        size: 26 + ((i * 17) % 58),
        duration: 26 + ((i * 7) % 26),
        delay: -(i * 4.5),
      })),
    []
  );

  return (
    <>
      <div className="pitch-bg" aria-hidden="true" />

      <div className="pitch-lines" aria-hidden="true">
        <svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
          {/* rond central */}
          <circle className="stroke" cx="600" cy="400" r="130" />
          <circle className="stroke" cx="600" cy="400" r="4" />
          {/* ligne médiane */}
          <line className="stroke" x1="600" y1="-50" x2="600" y2="850" />
          {/* surface de réparation gauche */}
          <path className="stroke" d="M-50 210 H210 V590 H-50" />
          <path className="stroke" d="M-50 320 H90 V480 H-50" />
          <path className="stroke" d="M210 400 a58 58 0 0 0 0 -1" />
          {/* surface de réparation droite */}
          <path className="stroke" d="M1250 210 H990 V590 H1250" />
          <path className="stroke" d="M1250 320 H1110 V480 H1250" />
        </svg>
      </div>

      <div className="floaters" aria-hidden="true">
        {floaters.map((f, i) => (
          <span
            key={i}
            className="floater"
            style={{
              left: f.left,
              width: f.size,
              height: f.size,
              animationDuration: `${f.duration}s`,
              animationDelay: `${f.delay}s`,
              color: i % 3 === 0 ? 'var(--decor-1)' : i % 3 === 1 ? 'var(--decor-2)' : 'var(--text)',
            }}
          />
        ))}
      </div>

      <span
        className="aura"
        aria-hidden="true"
        style={{ top: '-8%', left: '-6%', width: 420, height: 420, background: 'var(--decor-1)' }}
      />
      <span
        className="aura"
        aria-hidden="true"
        style={{
          bottom: '-12%',
          right: '-8%',
          width: 480,
          height: 480,
          background: 'var(--decor-3)',
          animationDelay: '-7s',
        }}
      />
    </>
  );
}
