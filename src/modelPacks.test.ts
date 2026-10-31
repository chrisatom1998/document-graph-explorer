import { describe, expect, it } from 'vitest';
// The pack selector is shared with Node's .mjs build hooks.
// @ts-expect-error Build scripts intentionally live outside the app TypeScript project.
import { selectModelCapabilities } from '../scripts/model-packs.mjs';

describe('model capability selection', () => {
  it('uses the bundled core pack by default', () => {
    expect(selectModelCapabilities(undefined)).toEqual({ requested: 'core', core: true, audio: false });
  });

  it('fetches audio only when explicitly requested', () => {
    expect(selectModelCapabilities('audio')).toEqual({ requested: 'audio', core: false, audio: true });
  });

  it.each(['full', 'airgap'])('includes every capability for %s builds', (value) => {
    expect(selectModelCapabilities(value)).toEqual({ requested: value, core: true, audio: true });
  });

  it('rejects unknown capability names', () => {
    expect(() => selectModelCapabilities('video')).toThrow(/core, audio, full, or airgap/);
  });
});
