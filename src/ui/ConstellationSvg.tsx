/**
 * Flat constellation mark. Two roles, both fallbacks:
 * - the Suspense placeholder while the 3D hero chunk loads, so the welcome
 *   card never reflows around an empty slot;
 * - the permanent visual when WebGL is unavailable.
 *
 * Decorative: the headline beside it carries the meaning, so it stays
 * aria-hidden rather than announcing a redundant description.
 */
export default function ConstellationSvg() {
  return (
    <svg className="empty-state__constellation" viewBox="0 0 360 272" fill="none" aria-hidden="true">
      <circle className="empty-state__orbit empty-state__orbit--outer" cx="180" cy="136" r="114" />
      <ellipse className="empty-state__orbit" cx="180" cy="136" rx="74" ry="126" />
      <path className="empty-state__link" d="M75 178 130 90l64 56 75-94 31 132-105-38-120 32Z" />
      <circle className="empty-state__node empty-state__node--core" cx="194" cy="146" r="15" />
      <circle className="empty-state__node" cx="75" cy="178" r="5" />
      <circle className="empty-state__node" cx="130" cy="90" r="7" />
      <circle className="empty-state__node empty-state__node--cyan" cx="269" cy="52" r="5" />
      <circle className="empty-state__node" cx="300" cy="184" r="6" />
      <circle className="empty-state__node empty-state__node--cyan" cx="155" cy="214" r="4" />
    </svg>
  );
}
