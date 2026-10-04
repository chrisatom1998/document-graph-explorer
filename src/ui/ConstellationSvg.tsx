import { useId } from 'react';

const SATELLITES = [
  { x: 82, y: 203, r: 8, cyan: true },
  { x: 141, y: 79, r: 10, cyan: false },
  { x: 322, y: 74, r: 6, cyan: true },
  { x: 402, y: 119, r: 12, cyan: true },
  { x: 345, y: 245, r: 9, cyan: false },
  { x: 194, y: 264, r: 5, cyan: false },
] as const;

/** A composed vector observatory, sharp at every pixel density without WebGL. */
export default function ConstellationSvg() {
  // Scope paint servers so multiple welcome surfaces can coexist.
  const id = useId();
  const paint = (name: string) => `url(#${id}-${name})`;

  return (
    <svg className="empty-state__constellation" viewBox="0 0 480 320" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}-atmosphere`}>
          <stop stopColor="#557dce" stopOpacity=".2" />
          <stop offset=".5" stopColor="#5657b4" stopOpacity=".08" />
          <stop offset="1" stopColor="#5657b4" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-corona`}>
          <stop stopColor="#d4eeff" stopOpacity=".42" />
          <stop offset=".28" stopColor="#7abaff" stopOpacity=".18" />
          <stop offset="1" stopColor="#719cff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-ice`} cx=".3" cy=".22" r=".8">
          <stop stopColor="#f2feff" />
          <stop offset=".25" stopColor="#a5e7f1" />
          <stop offset=".6" stopColor="#4488ab" />
          <stop offset="1" stopColor="#142740" />
        </radialGradient>
        <radialGradient id={`${id}-silver`} cx=".3" cy=".22" r=".8">
          <stop stopColor="#f5f2ff" />
          <stop offset=".25" stopColor="#c4c0ed" />
          <stop offset=".6" stopColor="#7775b6" />
          <stop offset="1" stopColor="#252c4a" />
        </radialGradient>
        <linearGradient id={`${id}-orbit`} x1="60" y1="250" x2="410" y2="70" gradientUnits="userSpaceOnUse">
          <stop stopColor="#85a8ce" stopOpacity=".12" />
          <stop offset=".48" stopColor="#b9d9f2" stopOpacity=".6" />
          <stop offset="1" stopColor="#8eaed3" stopOpacity=".18" />
        </linearGradient>
        <linearGradient id={`${id}-facet`} x1="220" y1="132" x2="257" y2="188" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fbffff" />
          <stop offset=".5" stopColor="#c3e6ff" />
          <stop offset="1" stopColor="#5c80c0" />
        </linearGradient>
      </defs>

      <ellipse cx="240" cy="160" rx="222" ry="153" fill={paint('atmosphere')} />

      {/* Sparse reference marks keep the focus on the orbital structure. */}
      <g stroke="#a3b7d7" strokeOpacity=".24" strokeWidth=".7">
        <path d="M42 58h8m-4-4v8M424 254h8m-4-4v8M376 42h6m-3-3v6M98 274h6m-3-3v6" />
        <path d="M232 29h16M240 26v6M232 291h16M240 288v6" />
      </g>
      <g fill="#a4bddf">
        <circle cx="83" cy="114" r="1" opacity=".45" />
        <circle cx="365" cy="193" r="1" opacity=".5" />
        <circle cx="278" cy="47" r="1.2" opacity=".5" />
        <circle cx="133" cy="236" r="1" opacity=".3" />
        <circle cx="432" cy="166" r="1" opacity=".35" />
      </g>

      <g stroke={paint('orbit')} strokeWidth=".85">
        <ellipse cx="240" cy="160" rx="190" ry="65" transform="rotate(-24 240 160)" />
        <ellipse cx="240" cy="160" rx="151" ry="94" transform="rotate(38 240 160)" />
        <ellipse cx="240" cy="160" rx="110" ry="129" transform="rotate(32 240 160)" opacity=".45" />
        <circle cx="240" cy="160" r="112" strokeDasharray="1 7" opacity=".3" />
      </g>

      <g stroke="#a4c9ef" strokeWidth=".75">
        <path d="m82 203 158-43 162-41M141 79l99 81 105 85M322 74l-82 86-46 104" strokeOpacity=".26" />
        <path d="m141 79 181-5 80 45M82 203l112 61 151-19" strokeOpacity=".12" />
      </g>
      <g fill="#d7edff">
        <circle cx="168" cy="180" r="1.6" />
        <circle cx="306" cy="143" r="1.6" />
        <circle cx="202" cy="129" r="1.25" opacity=".8" />
        <circle cx="289" cy="200" r="1.25" opacity=".8" />
      </g>

      {SATELLITES.map(({ x, y, r, cyan }) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r={r * 2.6} fill={paint('corona')} opacity=".45" />
          <circle cx={x} cy={y} r={r + 4} stroke={cyan ? '#a5e7f1' : '#c4c0ed'} strokeOpacity=".2" strokeWidth=".65" />
          <circle cx={x} cy={y} r={r} fill={paint(cyan ? 'ice' : 'silver')} stroke="#d9ecff" strokeOpacity=".38" strokeWidth=".65" />
          <circle cx={x - r * .28} cy={y - r * .35} r={r * .15} fill="#fff" opacity=".7" />
        </g>
      ))}

      <circle className="empty-state__stellar-glow" cx="240" cy="160" r="76" fill={paint('corona')} />
      <circle cx="240" cy="160" r="42" stroke="#b1d7ff" strokeOpacity=".16" strokeWidth=".7" />
      <circle cx="240" cy="160" r="34" stroke="#d1e5ff" strokeOpacity=".28" strokeWidth=".75" strokeDasharray="42 12 2 12" transform="rotate(-28 240 160)" />

      {/* Explicit facets keep the center legible in the compact welcome card. */}
      <path d="m240 130 23 30-23 30-23-30Z" fill={paint('facet')} stroke="#e4f5ff" strokeWidth=".9" />
      <path d="m240 130-5 29-18 1Z" fill="#fff" fillOpacity=".8" />
      <path d="m240 130 23 30-28-1Z" fill="#d7f0ff" fillOpacity=".7" />
      <path d="m217 160 18-1 5 31Z" fill="#8fbae5" />
      <path d="m235 159 28 1-23 30Z" fill="#517bac" fillOpacity=".65" />
      <path d="m240 130-5 29 5 31m-23-30 18-1 28 1" stroke="#f0faff" strokeOpacity=".7" strokeWidth=".65" />
      <path d="m235 147 1.5 10.5L247 159l-10.5 1.5L235 171l-1.5-10.5L223 159l10.5-1.5Z" fill="#f2fbff" />
    </svg>
  );
}
