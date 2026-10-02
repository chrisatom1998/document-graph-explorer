import { beforeEach, expect, it, vi } from 'vitest';
import { openMusicDecoder } from './decodeMusic';
const mock = vi.hoisted(() => ({ load:vi.fn(),writeFile:vi.fn(),ffprobe:vi.fn(),readFile:vi.fn(),terminate:vi.fn() }));
vi.mock('@ffmpeg/ffmpeg',()=>({FFmpeg:class{constructor(){return mock;}}}));
beforeEach(()=>{vi.clearAllMocks();mock.ffprobe.mockResolvedValue(-1);mock.readFile.mockResolvedValue('{"format":{"duration":"12.000000"}}');});
it('reads valid duration metadata even when WASM ffprobe returns minus one',async()=>{
 const decoder=await openMusicDecoder(new Blob(['audio']),'test.wav');
 expect(decoder.durationSeconds).toBe(12);decoder.close();
 expect(mock.terminate).toHaveBeenCalled();
});
it('preserves discovery mode for missing or invalid duration metadata',async()=>{
 for(const output of ['invalid','{"format":{}}','{"format":{"duration":"N/A"}}']){
  mock.readFile.mockResolvedValue(output);const decoder=await openMusicDecoder(new Blob(['audio']),'test.wav');
  expect(decoder.durationSeconds).toBe(0);decoder.close();
 }
});
it('keeps the duration limit even for valid metadata with a nonzero exit status',async()=>{
 mock.readFile.mockResolvedValue('{"format":{"duration":"86401"}}');
 await expect(openMusicDecoder(new Blob(['audio']),'test.wav')).rejects.toThrow('longer than 24 hours');
 expect(mock.terminate).toHaveBeenCalled();
});
