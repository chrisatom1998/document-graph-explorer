interface AudioPackMarker {
  schema: 1;
  capability: 'audio';
  revision: string;
  bytes: number;
}

export type AudioPackAuthorization = 'ready' | 'unavailable';

function isAudioPackMarker(value: unknown): value is AudioPackMarker {
  if (!value || typeof value !== 'object') return false;
  const marker = value as Partial<AudioPackMarker>;
  return marker.schema === 1 && marker.capability === 'audio' &&
    typeof marker.revision === 'string' && marker.revision.length > 0 &&
    Number.isSafeInteger(marker.bytes) && marker.bytes! > 0;
}

export function formatAudioPackSize(bytes: number): string {
  const megabytes = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(bytes / 1_000_000);
  return `${megabytes} MB (${new Intl.NumberFormat('en-US').format(bytes)} bytes)`;
}

async function loadAudioPackMarker(): Promise<AudioPackMarker | null> {
  try {
    const response = await fetch(new URL('audio-model-pack.json', document.baseURI), { cache: 'no-store' });
    if (!response.ok) return null;
    const marker: unknown = await response.json();
    return isAudioPackMarker(marker) ? marker : null;
  } catch {
    return null;
  }
}

export async function audioModelPackInstalled(): Promise<boolean> {
  return (await loadAudioPackMarker()) !== null;
}

/** Verify that the same-origin audio model pack is installed. */
export async function authorizeAudioModelPack(): Promise<AudioPackAuthorization> {
  const marker = await loadAudioPackMarker();
  if (!marker) {
    window.alert(
      'Audio analysis is not installed in this build. Developers can run `npm run models:audio` and rebuild, ' +
      'or build the complete offline package with `npm run models:full` / `npm run build:airgap`. ' +
      'Ask the person who supplied this app to install the audio model pack.',
    );
    return 'unavailable';
  }
  return 'ready';
}
