import { describe, expect, it } from 'vitest';
import { AUDIO_DEMO_CLIPS, AUDIO_DEMO_SAMPLE_RATE, createAudioDemoFiles } from './audioDemo';

describe('audio demo clips', () => {
  it('builds eight distinct 16-bit mono WAV files', () => {
    const files = createAudioDemoFiles();
    expect(files).toHaveLength(8);
    expect(new Set(files.map((file) => file.name)).size).toBe(8);

    for (const file of files) {
      expect(file.fileType).toBe('audio');
      expect(file.path).toBe(`demo-audio/${file.name}`);
      const view = new DataView(file.bytes);
      const text = (offset: number, value: string) =>
        [...value].every((char, index) => view.getUint8(offset + index) === char.charCodeAt(0));
      expect(text(0, 'RIFF')).toBe(true);
      expect(text(8, 'WAVE')).toBe(true);
      expect(view.getUint16(20, true)).toBe(1);
      expect(view.getUint16(22, true)).toBe(1);
      expect(view.getUint32(24, true)).toBe(AUDIO_DEMO_SAMPLE_RATE);
      expect(view.getUint32(40, true)).toBe(file.bytes.byteLength - 44);
      expect(file.bytes.byteLength).toBeGreaterThan(44);
    }
  });

  it('matches each clip duration', () => {
    const files = createAudioDemoFiles();
    AUDIO_DEMO_CLIPS.forEach((clip, index) => {
      const samples = (files[index].bytes.byteLength - 44) / 2;
      expect(files[index].name).toBe(clip.name);
      expect(samples).toBe(Math.max(1, Math.round(clip.seconds * AUDIO_DEMO_SAMPLE_RATE)));
    });
  });
});
