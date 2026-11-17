// Backward-compatible entry point for evaluation workflows and local scripts.
// New build hooks use fetch-models.mjs so their default can remain core-only.
import { fetchModelPacks } from './fetch-models.mjs';

await fetchModelPacks('audio');
