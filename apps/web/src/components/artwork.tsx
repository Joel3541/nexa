/**
 * Product artwork.
 *
 * Hand-authored SVG rather than bitmaps, for reasons that are practical before
 * they are aesthetic:
 *
 *  - **It themes.** Every fill references a CSS custom property, so the same
 *    artwork re-colours itself for dark mode instead of needing a second export
 *    that drifts out of sync with the first.
 *  - **It is ~6KB and vector.** No 400KB hero JPEG, no srcset ladder, nothing
 *    to go blurry on a retina screen — which matters on the mobile data plans
 *    NEXA's launch markets actually run on.
 *  - **It is legible as a product.** The shapes are the real primitives of the
 *    app — a revenue curve, a brief card, a stat tile — abstracted rather than
 *    invented. A generic 3D blob would say nothing about what NEXA does.
 *
 * The motion is deliberately slight: a slow float and a one-time draw. Hero
 * artwork that loops energetically competes with the copy next to it.
 */

/** Shared gradient and filter defs. Rendered once per instance; ids are scoped. */
function ArtDefs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity="0.42" />
        <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${id}-line`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="var(--color-brand-400)" />
        <stop offset="100%" stopColor="var(--color-brand-600)" />
      </linearGradient>
      <linearGradient id={`${id}-card`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="var(--surface)" stopOpacity="0.96" />
        <stop offset="100%" stopColor="var(--surface)" stopOpacity="0.82" />
      </linearGradient>
      <radialGradient id={`${id}-glow-a`} cx="50%" cy="50%">
        <stop offset="0%" stopColor="var(--color-brand-400)" stopOpacity="0.55" />
        <stop offset="100%" stopColor="var(--color-brand-400)" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${id}-glow-b`} cx="50%" cy="50%">
        <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.30" />
        <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${id}-glow-c`} cx="50%" cy="50%">
        <stop offset="0%" stopColor="#f472b6" stopOpacity="0.22" />
        <stop offset="100%" stopColor="#f472b6" stopOpacity="0" />
      </radialGradient>
      <pattern id={`${id}-grid`} width="26" height="26" patternUnits="userSpaceOnUse">
        <path d="M26 0H0V26" fill="none" stroke="var(--border)" strokeWidth="1" opacity="0.5" />
      </pattern>
      <filter id={`${id}-soft`} x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="10" stdDeviation="16" floodColor="#0b1020" floodOpacity="0.16" />
      </filter>
    </defs>
  );
}

/**
 * Landing-page hero visual: the product, abstracted.
 *
 * A revenue curve behind two floating cards — the Morning Brief and a stat
 * tile — which is exactly the hierarchy the dashboard itself uses.
 */
export function HeroVisual({ className }: { className?: string }) {
  const id = 'hero';
  return (
    <svg
      viewBox="0 0 640 460"
      className={className}
      role="img"
      aria-label="An abstract view of the NEXA dashboard: a rising revenue curve behind a morning brief card and a revenue stat tile."
      preserveAspectRatio="xMidYMid meet"
    >
      <ArtDefs id={id} />

      {/* Ambient colour. Three offset orbs read as depth without a bitmap. */}
      <ellipse cx="150" cy="120" rx="210" ry="170" fill={`url(#${id}-glow-a)`} />
      <ellipse cx="520" cy="330" rx="200" ry="160" fill={`url(#${id}-glow-b)`} />
      <ellipse cx="430" cy="90" rx="160" ry="120" fill={`url(#${id}-glow-c)`} />

      {/* Grid, clipped to a rounded plane so it fades rather than ends. */}
      <g opacity="0.7">
        <rect x="40" y="60" width="560" height="340" rx="22" fill={`url(#${id}-grid)`} />
      </g>

      {/* Revenue area + curve. The path is a plausible trajectory: a dip in the
          middle, recovery at the end — not a marketing-flat diagonal. */}
      <g transform="translate(40 60)">
        <path
          d="M20 250 C 80 232, 110 196, 158 200 C 206 204, 232 262, 280 248 C 330 234, 356 150, 410 138 C 462 126, 492 92, 540 66 L540 300 L20 300 Z"
          fill={`url(#${id}-area)`}
        />
        <path
          className="nexa-art-draw"
          d="M20 250 C 80 232, 110 196, 158 200 C 206 204, 232 262, 280 248 C 330 234, 356 150, 410 138 C 462 126, 492 92, 540 66"
          fill="none"
          stroke={`url(#${id}-line)`}
          strokeWidth="3.5"
          strokeLinecap="round"
          pathLength={1}
        />
        {/* Endpoint marker with a soft halo — the "you are here" of the curve. */}
        <circle cx="540" cy="66" r="13" fill="var(--color-brand-500)" opacity="0.18" />
        <circle cx="540" cy="66" r="5.5" fill="var(--color-brand-500)" stroke="var(--surface)" strokeWidth="2.5" />
      </g>

      {/* Morning Brief card. */}
      <g className="nexa-art-float" filter={`url(#${id}-soft)`}>
        <rect x="66" y="196" width="252" height="132" rx="18" fill={`url(#${id}-card)`} stroke="var(--border)" />
        <circle cx="92" cy="224" r="8" fill="var(--color-brand-500)" opacity="0.9" />
        <rect x="108" y="219" width="96" height="8" rx="4" fill="var(--color-brand-500)" opacity="0.75" />
        <rect x="88" y="248" width="204" height="9" rx="4.5" fill="var(--text)" opacity="0.80" />
        <rect x="88" y="266" width="168" height="9" rx="4.5" fill="var(--text)" opacity="0.42" />
        <rect x="88" y="292" width="86" height="20" rx="10" fill="var(--color-brand-500)" opacity="0.16" />
        <rect x="98" y="299" width="66" height="6" rx="3" fill="var(--color-brand-600)" opacity="0.85" />
      </g>

      {/* Stat tile, offset in depth and drifting on its own phase. */}
      <g className="nexa-art-float-slow" filter={`url(#${id}-soft)`}>
        <rect x="366" y="118" width="206" height="118" rx="18" fill={`url(#${id}-card)`} stroke="var(--border)" />
        <rect x="388" y="140" width="62" height="8" rx="4" fill="var(--text)" opacity="0.40" />
        <rect x="388" y="160" width="118" height="16" rx="6" fill="var(--text)" opacity="0.86" />
        {/* Trend pill */}
        <rect x="512" y="138" width="42" height="18" rx="9" fill="#10b981" opacity="0.16" />
        <path d="M523 150 L528 144 L533 150" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" />
        {/* Sparkline bars, ascending */}
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <rect
            key={i}
            x={388 + i * 24}
            y={214 - (10 + i * 4.5)}
            width="13"
            height={10 + i * 4.5}
            rx="3.5"
            fill="var(--color-brand-500)"
            opacity={0.28 + i * 0.09}
          />
        ))}
      </g>
    </svg>
  );
}

/**
 * Auth-screen panel visual.
 *
 * Quieter than the hero and vertically composed, because it sits beside a form
 * that must stay the focus. Same visual language, less of it.
 */
export function AuthVisual({ className }: { className?: string }) {
  const id = 'auth';
  return (
    <svg
      viewBox="0 0 460 420"
      className={className}
      role="img"
      aria-label="An abstract NEXA visual: a rising revenue curve with a summary card."
      preserveAspectRatio="xMidYMid meet"
    >
      <ArtDefs id={id} />

      <ellipse cx="120" cy="110" rx="190" ry="150" fill={`url(#${id}-glow-a)`} />
      <ellipse cx="360" cy="300" rx="170" ry="140" fill={`url(#${id}-glow-b)`} />

      <g opacity="0.55">
        <rect x="30" y="40" width="400" height="330" rx="20" fill={`url(#${id}-grid)`} />
      </g>

      <g transform="translate(30 60)">
        <path
          d="M14 236 C 62 224, 92 178, 138 186 C 184 194, 208 244, 252 228 C 296 212, 322 132, 386 104 L386 280 L14 280 Z"
          fill={`url(#${id}-area)`}
        />
        <path
          className="nexa-art-draw"
          d="M14 236 C 62 224, 92 178, 138 186 C 184 194, 208 244, 252 228 C 296 212, 322 132, 386 104"
          fill="none"
          stroke={`url(#${id}-line)`}
          strokeWidth="3.2"
          strokeLinecap="round"
          pathLength={1}
        />
        <circle cx="386" cy="104" r="12" fill="var(--color-brand-500)" opacity="0.18" />
        <circle cx="386" cy="104" r="5" fill="var(--color-brand-500)" stroke="var(--surface)" strokeWidth="2.5" />
      </g>

      <g className="nexa-art-float" filter={`url(#${id}-soft)`}>
        <rect x="54" y="238" width="228" height="112" rx="18" fill={`url(#${id}-card)`} stroke="var(--border)" />
        <circle cx="80" cy="264" r="7.5" fill="var(--color-brand-500)" opacity="0.9" />
        <rect x="95" y="259" width="88" height="7.5" rx="3.75" fill="var(--color-brand-500)" opacity="0.75" />
        <rect x="76" y="286" width="184" height="9" rx="4.5" fill="var(--text)" opacity="0.80" />
        <rect x="76" y="304" width="140" height="9" rx="4.5" fill="var(--text)" opacity="0.42" />
        <rect x="76" y="326" width="78" height="8" rx="4" fill="#10b981" opacity="0.55" />
      </g>
    </svg>
  );
}
