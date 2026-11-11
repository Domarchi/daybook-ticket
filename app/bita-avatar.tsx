/**
 * The face of Bita: a gold hard hat on a dark background, in the Daybook brand colours. It is the same avatar as Bita
 * in Daybook Parte Diario, so both apps show the same assistant.
 *
 * Inline SVG, not a file: it scales without another request. The brand colours do not change between light and dark;
 * the faint gold ring separates it from a dark background. Decorative for screen readers: the name is always written
 * next to it. The "thinking" animation lives in `bita.css` and only runs without reduced motion.
 */
export function BitaAvatar({ size = 32, thinking = false }: { size?: number; thinking?: boolean }) {
  return (
    <svg
      className={`bita-avatar${thinking ? ' thinking' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="32" cy="32" r="31" fill="#1c1d1a" stroke="#d99b27" strokeOpacity=".45" strokeWidth="2" />
      <g className="bita-hat">
        <path d="M16 38a16 16 0 0 1 32 0z" fill="#d99b27" />
        <rect x="29" y="19" width="6" height="10" rx="2" fill="#f6d16f" />
        <rect x="11" y="37" width="42" height="5" rx="2.5" fill="#f6d16f" />
      </g>
      <g className="bita-eyes" fill="#f3efe4">
        <circle cx="26" cy="49" r="2.3" />
        <circle cx="38" cy="49" r="2.3" />
      </g>
      <path d="M27 54.5q5 4 10 0" fill="none" stroke="#f3efe4" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
