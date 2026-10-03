import { beforeEach, expect, it, vi } from 'vitest';
import { openMusicDecoder } from './decodeMusic';
const mock = vi.hoisted(() => ({ load:vi.fn(),writeFile:vi.fn(),ffprobe:vi.fn(),readFile:vi.fn(),terminate:vi.fn(),exec:vi.fn(),deleteFile:vi.fn() }));
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

it('flushes delayed codec samples with bounded lookahead and limits output by sample count',async()=>{
 const decoder=await openMusicDecoder(new Blob(['audio']),'test.mp3');
 const values=Float32Array.from({length:176000},(_,i)=>i/176000);
 mock.exec.mockResolvedValue(0);mock.readFile.mockResolvedValue(new Uint8Array(values.buffer));
 const samples=await decoder.read(5,10,16000);
 expect(mock.exec).toHaveBeenCalledWith(expect.arrayContaining(['-ss','5','-t','11']),90000);
 expect(samples).toEqual(values.slice(0,160000));
 expect(mock.deleteFile).toHaveBeenCalledWith('clip.f32');decoder.close();
});
it('does not pad a genuinely short decoded tail or hide decoder failures',async()=>{
 const decoder=await openMusicDecoder(new Blob(['audio']),'test.mp3');
 const values=new Float32Array([.1,.2,.3]);
 mock.exec.mockResolvedValue(0);mock.readFile.mockResolvedValue(new Uint8Array(values.buffer));
 expect(await decoder.read(10,1,16000)).toEqual(values);
 mock.exec.mockResolvedValue(1);
 await expect(decoder.read(10,1,16000)).rejects.toThrow('could not be decoded');decoder.close();
});
