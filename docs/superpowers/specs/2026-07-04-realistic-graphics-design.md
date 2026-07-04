# Realistic Graphics — Design (2026-07-04)

Follow-up to the visual-polish pass (same date): make the deep-space scene read
like an astronomical photograph rather than stylized arcade space. The polish
pass already made the *objects* physical (glassy PBR cores, procedural env
map); this pass makes the *environment* physical. Hard constraints carried
over: **no new network destinations** (production CSP allows same-origin, HF
Hub, opt-in Gemini only — every texture is generated procedurally on a canvas),
the Labels↔Bloom threshold contract is untouched, and the starfield keeps its
"built once, zero per-frame work" property.

## 1. Photographic starfield

What breaks realism today: every star is one of two fixed sizes (1.6 / 3.2),
tinted from a fantasy blue/violet triad, at uniform brightness. Real fields
have a steep magnitude distribution (thousands of faint stars, a handful of
bright ones) and blackbody colors (warm oranges through white to blue-white,
never violet).

- New pure module `src/scene/starColors.ts`: Planckian-locus color
  approximation (`blackbodyColor(tempK)`), a temperature sampler weighted like
  the naked-eye sky (mostly yellow-white/white, warm and cool tails), and a
  power-law brightness sampler. Pure math, unit-tested (`starColors.test.ts`,
  Node env, same pattern as `palette.test.ts`).
- `Starfield.tsx` replaces the two fixed-size point layers with **one** points
  draw using a small custom ShaderMaterial: per-vertex size + color attributes
  (static), standard fogExp2 chunks so the far shell keeps its current depth
  falloff. Additive blending — stars are emitters.
- ~14 "hero" stars on a separate points layer using a procedural
  diffraction-spike sprite (bright core + cross flare), sized/colored from the
  same samplers' extremes. These intentionally cross the bloom threshold, the
  way bright stars bleed in long-exposure photos.

## 2. Volumetric nebula clouds

The "nebula dust" points stay (fine-grain sparkle), but real nebulae are soft
cloud structure, not dots. New `NebulaClouds.tsx`:

- Procedural fbm value-noise puff textures (3 seeds, 256px, canvas-generated,
  radial falloff so edges feather to nothing).
- ~18 interior wisps: billboard sprites inside the graph volume (same
  denser-toward-core distribution as the dust, radii kept inside the fit-all
  camera distance), 25–70u across, additive at 0.05–0.12 opacity, tinted in
  the astronomical palette that matches the app's identity (blue reflection
  nebula, H-alpha pink/magenta, a hint of OIII teal).
- ~8 far backdrop clouds on a ~450–550u shell behind the graph, 250–450u
  across, opacity ≤ 0.08 — large-scale structure behind the whole nebula.
- Everything static; sprite rotation variety comes from per-sprite material
  rotation and the 3 texture seeds. Additive blending is order-independent, so
  no sorting cost. Hidden at `qualityTier >= 3` (they are pure fill-rate),
  joining the existing tier-3 degradations.
- Brightness authored below the bloom threshold so clouds glow but never
  bloom-wash the graph; dust opacity drops slightly (0.45 → 0.38) so dust +
  clouds don't double-count.

## 3. Shared procedural textures

`makeSoftSprite` is currently duplicated in `Starfield.tsx` and `AiCore.tsx`.
New `src/scene/proceduralTextures.ts` owns it plus the new star-spike and
cloud generators; both components import from there.

## Non-goals

- No film grain / chromatic aberration (Effects.tsx caps the post chain
  deliberately) and no bloom parameter changes (Labels contract).
- No node/edge material changes — just landed in the polish pass.
- No animation: the environment stays zero-per-frame; realism here comes from
  distribution and structure, not motion.
- `palette.ts` untouched (has unrelated uncommitted WIP).

## Verification

`npm run typecheck`, `npm test` (incl. new starColors test), `npm run build`,
dev-server visual check.
