import { describe, expect, it } from 'vitest';
import { gpuModelBlockedReason } from './gpuModelPolicy';

const DESKTOP_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const ELECTRON = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Resonance/1.1.14 Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36';

describe('gpuModelBlockedReason', () => {
  it('allows desktop browsers and the desktop app', () => {
    expect(gpuModelBlockedReason({ userAgent: DESKTOP_CHROME, deviceMemory: 8 })).toBeNull();
    expect(gpuModelBlockedReason({ userAgent: ELECTRON })).toBeNull();
  });

  it('skips phones', () => {
    expect(gpuModelBlockedReason({ userAgent: ANDROID_CHROME, deviceMemory: 8 })).not.toBeNull();
    expect(gpuModelBlockedReason({ userAgent: IPHONE_SAFARI })).not.toBeNull();
    expect(gpuModelBlockedReason({ userAgent: DESKTOP_CHROME, userAgentData: { mobile: true } })).not.toBeNull();
  });

  it('skips data saver and low-memory devices', () => {
    expect(gpuModelBlockedReason({ userAgent: DESKTOP_CHROME, connection: { saveData: true } })).not.toBeNull();
    expect(gpuModelBlockedReason({ userAgent: DESKTOP_CHROME, deviceMemory: 2 })).not.toBeNull();
  });
});
