/**
 * Shared 18×18 stroke icons. No icon library — each inherits currentColor
 * from .btn-icon / menu items. Keep viewBoxes and stroke widths in this file
 * so chrome glyphs cannot drift apart.
 */

import type { ReactNode } from 'react';

type IconProps = { title?: string };

function Svg({
  children,
  viewBox = '0 0 18 18',
  fill = 'none',
  strokeWidth = '1.6',
  ...rest
}: IconProps & {
  children: ReactNode;
  viewBox?: string;
  fill?: string;
  strokeWidth?: string;
  strokeLinecap?: 'round' | 'butt';
  strokeLinejoin?: 'round' | 'miter';
}) {
  return (
    <svg
      viewBox={viewBox}
      fill={fill}
      stroke={fill === 'none' ? 'currentColor' : 'none'}
      strokeWidth={strokeWidth}
      aria-hidden={rest.title ? undefined : true}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconSearch() {
  return (
    <Svg>
      <circle cx="8" cy="8" r="5.25" />
      <line x1="12.1" y1="12.1" x2="16" y2="16" strokeLinecap="round" />
    </Svg>
  );
}

export function IconFit() {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6V3a1 1 0 0 1 1-1h3" />
      <path d="M16 6V3a1 1 0 0 0-1-1h-3" />
      <path d="M2 12v3a1 1 0 0 0 1 1h3" />
      <path d="M16 12v3a1 1 0 0 1-1 1h-3" />
      <rect x="6" y="6" width="6" height="6" rx="1" />
    </Svg>
  );
}

export function IconCube({ twoD }: { twoD: boolean }) {
  if (twoD) {
    return (
      <Svg>
        <rect x="3" y="3" width="12" height="12" rx="1.5" />
      </Svg>
    );
  }
  return (
    <Svg strokeWidth="1.5" strokeLinejoin="round">
      <path d="M9 2 L15.5 5.6 V12.4 L9 16 L2.5 12.4 V5.6 Z" />
      <path d="M9 2 V9 M9 9 L15.5 5.6 M9 9 L2.5 5.6 M9 9 V16" strokeOpacity="0.55" />
    </Svg>
  );
}

export function IconOctahedron() {
  return (
    <Svg strokeLinejoin="round">
      <path d="M9 1.5 L15.5 9 L9 16.5 L2.5 9 Z" />
      <path d="M2.5 9 L15.5 9" strokeOpacity="0.55" />
    </Svg>
  );
}

export function IconView() {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 9S4.4 3.6 9 3.6 16.5 9 16.5 9 13.6 14.4 9 14.4 1.5 9 1.5 9Z" />
      <circle cx="9" cy="9" r="2.4" />
    </Svg>
  );
}

export function IconGear() {
  return (
    <Svg viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Svg>
  );
}

export function IconHelp() {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="7" />
      <path d="M6.9 6.8A2.2 2.2 0 0 1 9 5.4c1.3 0 2.3.8 2.3 2 0 1.7-2.1 1.8-2.1 3.2" />
      <path d="M9 13.2h.01" />
    </Svg>
  );
}

export function IconPath() {
  return (
    <Svg strokeLinecap="round">
      <circle cx="4" cy="14" r="2.2" />
      <circle cx="14" cy="4" r="2.2" />
      <path d="M5.6 12.4 L8.5 9.5 M9.5 8.5 L12.4 5.6" strokeDasharray="0.1 2.6" />
    </Svg>
  );
}

export function IconBulb() {
  return (
    <Svg strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2.2a4.6 4.6 0 0 0-2.7 8.3c.6.5 1 1.1 1 1.8v.5h3.4v-.5c0-.7.4-1.3 1-1.8A4.6 4.6 0 0 0 9 2.2Z" />
      <path d="M7.4 14.8h3.2M8.1 16.5h1.8" />
    </Svg>
  );
}

export function IconHistory() {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 9a6.5 6.5 0 1 1 1.2 3.8" />
      <polyline points="2 5.5 2.5 9 6 8.5" />
      <polyline points="9 5.5 9 9.5 12 11" />
    </Svg>
  );
}

export function IconData() {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="9" cy="4.2" rx="5.5" ry="2.2" />
      <path d="M3.5 4.2v4.8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V4.2" />
      <path d="M3.5 9v4.8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V9" />
    </Svg>
  );
}

export function IconGrip() {
  return (
    <Svg fill="currentColor" strokeWidth="0">
      <circle cx="6.5" cy="4" r="1.3" />
      <circle cx="11.5" cy="4" r="1.3" />
      <circle cx="6.5" cy="9" r="1.3" />
      <circle cx="11.5" cy="9" r="1.3" />
      <circle cx="6.5" cy="14" r="1.3" />
      <circle cx="11.5" cy="14" r="1.3" />
    </Svg>
  );
}

export function IconPlus() {
  return (
    <Svg strokeWidth="1.8" strokeLinecap="round">
      <path d="M9 3.2V14.8" />
      <path d="M3.2 9H14.8" />
    </Svg>
  );
}

export function IconFolderPlus() {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.8 5a1.2 1.2 0 0 1 1.2-1.2h3.3l1.7 1.9h7a1.2 1.2 0 0 1 1.2 1.2v6.3a1.2 1.2 0 0 1-1.2 1.2H3a1.2 1.2 0 0 1-1.2-1.2Z" />
      <path d="M9.5 8.1v3.4M7.8 9.8h3.4" />
    </Svg>
  );
}

export function IconAnalyze() {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4.2" cy="12.8" r="1.7" />
      <circle cx="9" cy="4.2" r="1.7" />
      <circle cx="13.8" cy="12.8" r="1.7" />
      <path d="M5.6 11.6 8 5.8M10 5.8l2.4 5.8M5.7 12.8h6.6" />
    </Svg>
  );
}

export function IconCollab() {
  return (
    <Svg strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6.5" r="2.2" />
      <circle cx="12.5" cy="5.7" r="2" />
      <path d="M2.2 13.2c.5-1.8 2.2-2.8 4.1-2.8s3.6 1 4.1 2.8" />
      <path d="M9.5 12.9c.4-1.5 1.6-2.3 3.1-2.3 1.4 0 2.6.8 3.1 2.3" />
    </Svg>
  );
}

export function IconFunnel() {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 3.5h13L10.5 9.2v5l-3 1.6V9.2Z" />
    </Svg>
  );
}

export function IconChat() {
  return (
    <Svg viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </Svg>
  );
}

export function IconBookmark() {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 2.5h9v13l-4.5-3.4-4.5 3.4v-13Z" />
    </Svg>
  );
}

export function IconJson() {
  return (
    <Svg>
      <path d="M5.2 2.5H12L15 5.5v10H5.2a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" />
      <path d="M12 2.5v3h3" />
      <path d="M6.4 8.1c-.7.4-1 1-1 1.8s.3 1.4 1 1.8" strokeLinecap="round" />
      <path d="M11.6 8.1c.7.4 1 1 1 1.8s-.3 1.4-1 1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function IconImage() {
  return (
    <Svg>
      <rect x="2.7" y="3" width="12.6" height="12" rx="1.8" />
      <circle cx="6.5" cy="6.8" r="1.2" />
      <path d="M4 13l3.5-3.5 2.2 2.1 1.5-1.5L14 13" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconUsd() {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2.2 15 5.5v7L9 15.8 3 12.5v-7L9 2.2Z" />
      <path d="M3 5.5 9 8.8l6-3.3" />
      <path d="M9 8.8v7" />
    </Svg>
  );
}

export function IconImport() {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2.5v8" />
      <path d="M5.8 7.5 9 10.7l3.2-3.2" />
      <path d="M3.5 12.5v1.8c0 .8.6 1.4 1.4 1.4h8.2c.8 0 1.4-.6 1.4-1.4v-1.8" />
    </Svg>
  );
}

export function IconLink() {
  return (
    <Svg>
      <path d="M7.2 10.8 10.8 7.2" strokeLinecap="round" />
      <path d="M6.1 12.7 4.8 14a2.6 2.6 0 0 1-3.7-3.7l2.4-2.4a2.6 2.6 0 0 1 3.7 0" strokeLinecap="round" />
      <path d="m11.9 5.3 1.3-1.3a2.6 2.6 0 1 1 3.7 3.7l-2.4 2.4a2.6 2.6 0 0 1-3.7 0" strokeLinecap="round" />
    </Svg>
  );
}
