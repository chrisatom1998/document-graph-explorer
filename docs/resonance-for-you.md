# Resonance "For you" view and its browser tests

## What it is

The first tab of the Resonance shell (`src/ui/resonance/ForYou.tsx`, styles in `forYou.css`). Everything on it
is derived from the graph in memory (`forYouModel.ts`):

- **Sound map**: clip count and neighbourhood count (distinct clusters). Neighbourhoods are omitted until
  clustering has assigned them. The constellation draws real clips and only the links that exist.
- **Mixes in key**: the most common detected (or file-name) key among the clips, with the tempo range of the
  clips that have one. No key, no crate.
- **Sounds like …**: linked clips, strongest link first; falls back to the rest of the library and says so.
- **Tags**: the labels the Sounds row already shows, with how each was found. Confirmed and model-"likely"
  labels are solid; "possible" and file-name-derived labels are outlined and carry "(possible)" / "(from name)".
- **Transport** (`Transport.tsx`): fixed bottom player for the saved original of the chosen clip. One sound at a
  time across every player (`src/audio/singlePlayer.ts`).
- "Add a folder" / "Add files" use the existing pickers (`openFolderPicker`, `openFilePicker`).

## Browser tests without models

`e2e/for-you.spec.ts` runs against a **built** app served by `vite preview` on 127.0.0.1:

```
node scripts/build-e2e.mjs            # vite build with VITE_E2E_NO_INFERENCE=1; no model-fetch hook
npx playwright test -c playwright.for-you.config.ts
```

`VITE_E2E_NO_INFERENCE=1` turns on `src/e2e/noInference.ts`, which is **off in every other build** (a unit test
checks the repo never sets it). When on: audio model preloading and analysis are skipped and counted, text
embeddings come from a deterministic hashed stub (`e2eStubEmbed`, test-only, never shown as product output), and
any inference entry point that is reached anyway records a violation the tests assert is empty. File parsing,
persistence, graph nodes, WebAudio decode and playback are real. Tests also guard the browser context (non-local
and model/inference-runtime requests are aborted and fail the test) and Chrome is launched with a host-resolver
rule that makes every host except 127.0.0.1 unresolvable.

Not covered: real tempo/key/tag analysis and real embeddings.

## Vercel

`vercel.json` carries `git.deploymentEnabled` with this branch set to `false`, so Git pushes of
`feat/resonance-for-you-2026-11-07` do not create deployments; all other branches keep the project default.
Remove that entry before merging if the branch name is reused. Nothing here deploys anything.
