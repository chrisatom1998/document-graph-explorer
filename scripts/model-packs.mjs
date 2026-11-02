export const AUDIO_MODEL_ROOTS = [
  'public/music-model',
  'public/sound-model',
  'public/jamendo-model',
  'public/tagger-model',
];

export const AUDIO_PACK_MARKER = 'public/audio-model-pack.json';

/** Resolve the requested model capabilities. Core assets are checked into the
 * repository; audio is the only capability that requires a network fetch. */
export function selectModelCapabilities(value = process.env.DGE_MODELS) {
  const requested = (value || 'core').trim().toLowerCase();
  if (requested === 'core') return { requested, core: true, audio: false };
  if (requested === 'audio') return { requested, core: false, audio: true };
  if (requested === 'full' || requested === 'airgap') {
    return { requested, core: true, audio: true };
  }
  throw new Error(`Unknown model capability "${value}". Use core, audio, full, or airgap.`);
}
