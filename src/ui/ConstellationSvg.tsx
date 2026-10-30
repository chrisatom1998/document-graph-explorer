import { useId } from 'react';

/**
 * Welcome mark: a miniature of the default 2D map.
 *
 * Documents are dots, the topic hub is a diamond, and one link is drawn in
 * the shell's lime — the same accent the workspace uses for the current
 * selection. Orbit rings and a gem read as a logo and, at this size, hide
 * the graph. A dash travels the lime link; reduced motion pins that dash.
 */
export default function ConstellationSvg() {
  const id = useId();
  const paint = (name: string) => `url(#${id}-${name})`;

  return (
    <svg className="empty-state__constellation" viewBox="12 18 236 128" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}-field`} cx="46%" cy="50%" r="62%">
          <stop stopColor="#c8f55a" stopOpacity="0.18" />
          <stop offset="0.38" stopColor="#a89bff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#a89bff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-doc`} cx="32%" cy="28%" r="78%">
          <stop stopColor="#34324c" />
          <stop offset="1" stopColor="#14141c" />
        </radialGradient>
        <radialGradient id={`${id}-selected`} cx="32%" cy="26%" r="78%">
          <stop stopColor="#314218" />
          <stop offset="1" stopColor="#14160e" />
        </radialGradient>
        <filter id={`${id}-glow`} x="-40%" y="-80%" width="180%" height="260%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
      </defs>

      <ellipse cx="128" cy="82" rx="112" ry="58" fill={paint('field')} />

      {/* Quiet edges inside each community. */}
      <g stroke="#8a86a0" strokeWidth="1.35" strokeLinecap="round" strokeOpacity="0.85">
        <path d="M58 50 96 78M40 98 90 86M72 122 98 94" />
        <path d="M176 46 204 80M164 122 192 96M222 126 208 92M176 46 164 122" />
      </g>

      {/* The relationship the selection is explaining. */}
      <line x1="116" y1="82" x2="188" y2="84" stroke="#c8f55a" strokeOpacity="0.28" strokeWidth="5" strokeLinecap="round" filter={paint('glow')} />
      <line x1="116" y1="82" x2="188" y2="84" stroke="#c8f55a" strokeOpacity="0.45" strokeWidth="1.7" strokeLinecap="round" />
      <line
        className="empty-state__bridge"
        x1="116"
        y1="82"
        x2="188"
        y2="84"
        pathLength={100}
        stroke="#c8f55a"
        strokeWidth="2.25"
        strokeLinecap="round"
      />

      <g fill={paint('doc')} stroke="#a89bff" strokeWidth="1.6">
        <circle cx="58" cy="50" r="9" />
        <circle cx="40" cy="98" r="7.5" />
        <circle cx="72" cy="122" r="8" />
        <circle cx="204" cy="82" r="11" />
        <circle cx="164" cy="122" r="7.5" />
        <circle cx="222" cy="126" r="6.5" />
      </g>
      <g fill="#fff" opacity="0.42">
        <circle cx="55" cy="46.6" r="1.7" />
        <circle cx="37.4" cy="95" r="1.4" />
        <circle cx="69.2" cy="118.8" r="1.5" />
        <circle cx="200.2" cy="77.6" r="2.1" />
        <circle cx="161.4" cy="119" r="1.4" />
        <circle cx="219.8" cy="123.4" r="1.2" />
      </g>

      {/* Selected document. The lime ring is the shell's current-item mark. */}
      <circle className="empty-state__select-ring" cx="176" cy="46" r="14.5" stroke="#c8f55a" strokeWidth="1.5" />
      <circle cx="176" cy="46" r="8" fill={paint('selected')} stroke="#c8f55a" strokeWidth="1.7" />
      <circle cx="173.4" cy="43.2" r="1.6" fill="#fff" opacity="0.6" />

      {/* Topic hub. The help legend draws these as diamonds and documents as dots. */}
      <polygon
        points="104,64 120,82 104,100 88,82"
        fill="#1a1a24"
        stroke="#e4e0ff"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <polygon points="104,71 111,82 104,88 97,82" fill="#fff" opacity="0.34" />
    </svg>
  );
}
