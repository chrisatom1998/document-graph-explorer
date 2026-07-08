# 2D Constellation View — Design

**Date:** 2026-07-08
**Status:** Implemented
**Preview:** interactive mockup shared as a Claude artifact ("KnowledgeNebula — 2D Constellation Preview")

## Goal

When the user switches to 2D (View ▾ → 2D view), the graph should read as a
flat constellation/star chart (per the reference screenshot): dark ink
background, small pale-cyan dots, straight faint hairline edges, monospace
labels beside the dots. All existing functionality — hover/selection emphasis,
search & Show-me gold, cluster filters, drag-to-pin, path mode, pulses,
minimap, PNG export, and the toggle back to 3D — is preserved.

## Approach

Pure restyle keyed off the existing `uiStore.dims === 2` flag inside the
existing scene components (no parallel renderer, no new state). The layout
worker's z=0 flattening and the CameraRig equator clamp already handle the
geometry; this work only changes what the flat scene looks like.

Rejected alternatives:

- **Separate 2D renderer component tree** — duplicates picking/drag/label
  machinery for no benefit.
- **Theme abstraction layer** — YAGNI for two looks.

## Tokens (scene/palette.ts)

| Token | Value | Use |
|---|---|---|
| `FLAT_BG` | `#0c141d` | canvas background + fog |
| `FLAT_NODE` | `#8fd0e2` | node dot cyan |
| `FLAT_NODE_CLUSTER_BLEND` | `0.25` | whisper of cluster hue kept for legend/filter legibility |
| `FLAT_EDGE` | `#8fb0c9` | uniform hairline tint |
| `FLAT_LABEL` | `#c5ced6` | label gray |

## Changes by file

- **NebulaCanvas.tsx** — background/fog swap to `FLAT_BG`; Starfield,
  NebulaClouds, and AiCore unmount in 2D.
- **Nodes.tsx** — core material swaps to flat `meshBasicMaterial`; sizing
  compresses to 0.55–1.3 (vs 0.7–2.6); halo shells off (`halo.count = 0`);
  base color = `FLAT_NODE` lerped 25% toward the cluster hue. Ghosting,
  hover/selection brightening, Show-me gold, materialize pop unchanged.
- **Edges.tsx** — control point at chord midpoint (bezier degenerates to a
  straight line, same buffers); uniform `FLAT_EDGE` tint; brightness
  `0.10 + 0.30·weight` (vs `0.16 + 0.55·weight`); no mid-arc taper.
  Density fade, emphasis dim, focus boost unchanged.
- **EdgePulses.tsx** — pulses ride the same straight line in 2D (midpoint
  control); keep hot kind tints (interaction feedback, matches legend).
- **Labels.tsx** — JetBrains Mono, anchored left/middle to the RIGHT of the
  dot (`x + radius + 1.4`), `FLAT_LABEL` on `FLAT_BG` outline. Pool,
  distance culling, reserved hover/selected labels unchanged.
- **Effects.tsx** — bloom intensity 0.5 (faint dot glow standing in for the
  removed halos), DoF disabled in 2D, vignette 0.4.
- **public/fonts/JetBrainsMono-Regular.ttf** — new, OFL-1.1, vendored
  (privacy CSP forbids CDN fonts); LICENSE.md updated.

## Back to 3D

The existing View ▾ menu item toggles `dims` both ways (`Switch to 2D` /
`Switch to 3D`) — untouched. Every 2D branch above keys off the live store
value, so toggling back restores the nebula exactly.
