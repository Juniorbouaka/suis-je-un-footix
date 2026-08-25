/**
 * Jeu d'icônes SVG maison — aucune dépendance, aucun emoji.
 * Usage : <Icon name="target" /> · hérite de la couleur du texte.
 */
const PATHS = {
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.4" />
    </>
  ),
  swords: (
    <>
      <path d="M4 4l8.5 8.5M20 4l-8.5 8.5" />
      <path d="M14.5 15.5L20 21M9.5 15.5L4 21" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </>
  ),
  moon: <path d="M20 13.5A8.5 8.5 0 1 1 10.5 4a6.8 6.8 0 0 0 9.5 9.5z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  trophy: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11" />
      <path d="M12 14v3.5M8.5 20h7" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5 10-11" />,
  flag: (
    <>
      <path d="M6 21V4" />
      <path d="M6 4.5h11l-2.2 4 2.2 4H6" />
    </>
  ),
  link: (
    <>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.4 1.4" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.4-1.4" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-6A3.5 3.5 0 0 0 3 6.5v6A2.5 2.5 0 0 0 5.5 15" />
    </>
  ),
  dice: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  repeat: (
    <>
      <path d="M4 11V9a4 4 0 0 1 4-4h9" />
      <path d="M14 2.5L17.5 5 14 7.5" />
      <path d="M20 13v2a4 4 0 0 1-4 4H7" />
      <path d="M10 21.5L6.5 19 10 16.5" />
    </>
  ),
  flame: <path d="M12 3s5.5 4.2 5.5 9a5.5 5.5 0 0 1-11 0c0-1.9 1-3.5 2-4.5.3 1.6 1.2 2.5 2 2.5 1.2 0 1.5-1.4 1.5-3 0-1.6 0-3 0-4z" />,
  bolt: <path d="M13.5 2.5L5 13.5h6l-.5 8L19 10.5h-6l.5-8z" />,
  book: (
    <>
      <path d="M4 4.5h6a3 3 0 0 1 3 3v12a2.4 2.4 0 0 0-2.4-2.4H4z" />
      <path d="M20 4.5h-6a3 3 0 0 0-3 3v12a2.4 2.4 0 0 1 2.4-2.4H20z" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 5.6M17.5 14.5a6.5 6.5 0 0 1 4 5.5" />
    </>
  ),
  brain: (
    <>
      <path d="M12 5.5a3 3 0 0 0-5.7-1.3A2.8 2.8 0 0 0 4 9.4a3 3 0 0 0 .6 4.8A3 3 0 0 0 9 18.8a2.9 2.9 0 0 0 3 1.7z" />
      <path d="M12 5.5a3 3 0 0 1 5.7-1.3A2.8 2.8 0 0 1 20 9.4a3 3 0 0 1-.6 4.8A3 3 0 0 1 15 18.8a2.9 2.9 0 0 1-3 1.7z" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.5l8.5 15h-17z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  medal: (
    <>
      <circle cx="12" cy="15" r="5.5" />
      <path d="M8.5 10L6 2.5h12L15.5 10" />
    </>
  ),
  crown: (
    <>
      <path d="M3 7l4 3.5L12 4l5 6.5L21 7l-1.8 12H4.8L3 7z" />
      <path d="M4.8 15.5h14.4" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  play: <path d="M7 4.5l12 7.5-12 7.5v-15z" />,
  chart: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 20v-6M13 20V8M18 20v-9" />
    </>
  ),
  heart: (
    <path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.5 2.7c0 5.8-8.5 11.3-8.5 11.3z" />
  ),
  // L'essai gratuit : un paquet cadeau. C'est le seul endroit du jeu où
  // l'on donne quelque chose, autant que l'icône le dise.
  gift: (
    <>
      <rect x="3.5" y="10" width="17" height="10.5" rx="1.6" />
      <path d="M2.5 6.5h19V10h-19z" />
      <path d="M12 6.5v14" />
      <path d="M12 6.5C10.5 6.5 7 6.6 7 4.6A2.1 2.1 0 0 1 12 4a2.1 2.1 0 0 1 5 .6c0 2-3.5 1.9-5 1.9z" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-1.2-1-1.6-1-2.7 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7z" />
      <circle cx="7.5" cy="11" r="1.1" />
      <circle cx="12" cy="7.5" r="1.1" />
      <circle cx="16.5" cy="11" r="1.1" />
    </>
  ),
};

export default function Icon({ name, size = 18, className = '', strokeWidth = 1.8 }) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  );
}
