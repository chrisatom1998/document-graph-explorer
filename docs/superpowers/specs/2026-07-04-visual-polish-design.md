# Visual Polish — Design (2026-07-04)

Six approved appearance improvements. Approach chosen per item after surveying the
existing visual stack (which already has a fresnel node corona, curved additive
edges with density fade, bloom/DoF/vignette, glass panels with backdrop blur, and
reduced-motion support). Everything below builds on that baseline; nothing is
rebuilt. Hard constraint throughout: **no new network destinations** — the
production CSP (vite.config.ts `injectCsp`) allows same-origin, HF Hub, and the
opt-in Gemini endpoint only. All assets are self-hosted.

## 1. Typography

Replace the generic `system-ui` UI stack with self-hosted **Space Grotesk**
(variable, 300–700, OFL) — a geometric grotesk that matches the observatory
theme. Latin + latin-ext woff2 subsets in `src/assets/fonts/` (bundled by Vite,
served same-origin) plus the OFL license file. `--font-reading` (Georgia) and
`--font-mono` stay. Add `font-feature-settings: 'tnum'` on stat-bearing elements
so counters and metrics align. `font-display: swap` keeps first paint on the
system stack; nothing external is ever fetched.

## 2. Node core material

The corona halo already does the fresnel glow; the gap is the core sphere:
`meshPhongMaterial` reads as plastic. Upgrade to `meshPhysicalMaterial`
(clearcoat 1.0, low roughness) fed by a **procedurally generated environment
map** — drei `<Environment resolution={64}>` with a handful of emissive strips
as children, rendered once to a PMREM at startup. No HDR download (CSP). Cores
become glassy marbles with structured reflections; per-instance cluster color
continues to flow through `instanceColor`.

## 3. Edge gradients + depth fade

Edges keep their kind tint (it is information — legend + popover depend on it)
but blend **35% of each endpoint's cluster color** into the vertex gradient, so
filaments visibly belong to the communities they join. `reference` edges are
exempt (spec calls for pure warm amber precisely so they pop). Runs inside the
existing `recomputeColors` pass — no per-frame cost.

Depth fade is GPU-side: `onBeforeCompile` on the line material injects a
view-distance attenuation (smoothstep to ~50% brightness at far range) — aerial
perspective that makes near filaments read crisper. No CPU per-frame work.

## 4. Selection glow

New `SelectionHalo` component: a single additive ring-shader billboard (not
instanced) that tracks the selected node's slot in `positionBuffer` each frame,
scaled to the node's radius, pulsing gently (`toneMapped={false}` so it feeds
bloom). Static ring under `prefers-reduced-motion`. Complements the existing
emphasis dimming and tier-0 DoF; removed from the scene when nothing is
selected.

## 5. Cluster palette audit

Keep the golden-angle hue walk (cluster ids must keep stable hues) but replace
the fixed `S=0.82, L=0.56` with per-hue-band lightness/saturation equalization
(HSL yellows/greens read far lighter and muddier than blues at equal L).
Follow the dataviz skill's color method. Add a unit test
(`palette.test.ts`) asserting: (a) minimum pairwise perceptual distance among
the first 12 cluster colors, (b) every cluster color clears a minimum contrast
against the `#050510` void background.

## 6. Micro-interactions

CSS-only: easing tokens (`--ease-out-soft`, `--ease-spring`), hover
elevation (translateY + shadow + border brighten) on interactive glass cards,
`:focus-visible` accent rings on buttons/inputs, springy pop-in for appearing
overlays. All inside the existing reduced-motion kill switch.

## Verification

`npm run typecheck`, `npm test` (incl. new palette test), `npm run build`
(exercises the CSP injection path), dev-server smoke check.
