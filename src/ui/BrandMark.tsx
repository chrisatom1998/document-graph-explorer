/**
 * gTech brand lockup pinned to the top-left corner. Purely decorative — the
 * overlay wrapper is pointer-events:none so orbit input passes straight
 * through to the canvas underneath. Bundled from src/assets (same-origin), so
 * the production CSP never has to reach an external host.
 */

import logoUrl from '../assets/gtech_logo_horizontal.png';

export default function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <img className="brand-mark__img" src={logoUrl} alt="gTech ads" />
    </div>
  );
}
