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
 mock.readFile.mockResolvedValue('{"format":{"duration":"120"}}');
 const decoder=await openMusicDecoder(new Blob(['audio']),'test.mp3');
 const values=Float32Array.from({length:176000},(_,i)=>i/176000);
 mock.exec.mockResolvedValue(0);mock.readFile.mockResolvedValue(new Uint8Array(values.buffer));
 const samples=await decoder.read(5,10,16000);
 expect(mock.exec).toHaveBeenCalledWith(expect.arrayContaining(['-ss','5','-t','11']),90000);
 expect(samples).toEqual(values.slice(0,160000));
 expect(mock.deleteFile).toHaveBeenCalledWith('clip.f32');decoder.close();
});
it('does not pad a genuinely short decoded tail or hide decoder failures',async()=>{
 mock.readFile.mockResolvedValue('{"format":{"duration":"120"}}');
 const decoder=await openMusicDecoder(new Blob(['audio']),'test.mp3');
 const values=new Float32Array([.1,.2,.3]);
 mock.exec.mockResolvedValue(0);mock.readFile.mockResolvedValue(new Uint8Array(values.buffer));
 expect(await decoder.read(10,1,16000)).toEqual(values);
 mock.exec.mockResolvedValue(1);
 await expect(decoder.read(10,1,16000)).rejects.toThrow('could not be decoded');decoder.close();
});
it('restarts FFmpeg every 50 section decodes and retries a crashed section once on a fresh instance',async()=>{
 mock.readFile.mockResolvedValue('{"format":{"duration":"300"}}');
 const decoder=await openMusicDecoder(new Blob(['audio']),'song.mp3');
 const values=new Float32Array(16000);
 mock.exec.mockResolvedValue(0);mock.readFile.mockResolvedValue(new Uint8Array(values.buffer));
 for(let i=0;i<50;i++)await decoder.read(i,1,16000);
 expect(mock.terminate).not.toHaveBeenCalled();
 await decoder.read(50,1,16000);
 expect(mock.terminate).toHaveBeenCalledTimes(1);
 expect(mock.load).toHaveBeenCalledTimes(2);
 expect(mock.writeFile).toHaveBeenCalledTimes(2);
 // The WASM build reports its crash as a thrown string.
 mock.exec.mockRejectedValueOnce('RuntimeError: memory access out of bounds');
 expect(await decoder.read(60,1,16000)).toHaveLength(16000);
 expect(mock.terminate).toHaveBeenCalledTimes(2);
 mock.exec.mockRejectedValue('RuntimeError: memory access out of bounds');
 await expect(decoder.read(70,1,16000)).rejects.toBe('RuntimeError: memory access out of bounds');
 decoder.close();
});
it('keeps the live decoder when recycle setup fails and retries the section',async()=>{
 mock.readFile.mockResolvedValue('{"format":{"duration":"300"}}');
 const decoder=await openMusicDecoder(new Blob(['audio']),'song.mp3');
 const values=new Float32Array(16000);
 mock.exec.mockResolvedValue(0);mock.readFile.mockResolvedValue(new Uint8Array(values.buffer));
 for(let i=0;i<50;i++)await decoder.read(i,1,16000);
 mock.load.mockRejectedValueOnce(new Error('load failed'));
 expect(await decoder.read(50,1,16000)).toHaveLength(16000);
 expect(await decoder.read(51,1,16000)).toHaveLength(16000);
 decoder.close();
});
it('does not permanently close the shared decoder when recycle and retry outlast the section watchdog',async()=>{
 vi.useFakeTimers();
 mock.readFile.mockResolvedValue('{"format":{"duration":"300"}}');
 const decoder=await openMusicDecoder(new Blob(['audio']),'song.mp3');
 try {
  const values=new Float32Array(16000);
  mock.exec.mockResolvedValue(0);mock.readFile.mockResolvedValue(new Uint8Array(values.buffer));
  for(let i=0;i<50;i++)await decoder.read(i,1,16000);
  mock.exec.mockImplementationOnce(()=>new Promise((_,reject)=>{
   setTimeout(()=>reject('RuntimeError: memory access out of bounds'),90_000);
  })).mockImplementationOnce(()=>new Promise(resolve=>{
   setTimeout(()=>resolve(0),90_000);
  }));
  const reading=decoder.read(50,1,16000);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(await reading).toHaveLength(16000);
  expect(await decoder.read(60,1,16000)).toHaveLength(16000);
 } finally { decoder.close(); vi.useRealTimers(); }
});

function audioFixture(duration = 10, actualDuration = duration) {
 mock.exec.mockResolvedValue(0);
 mock.readFile.mockImplementation(async (name: string) => {
  if (name === 'probe.json') return JSON.stringify({format:{duration:String(duration)}});
  const rate = Number(name.match(/decoded-(\d+)/)?.[1] ?? 16000);
  const samples = Float32Array.from({length: Math.round(actualDuration * rate)}, (_, i) => (i % 100) / 100);
  return new Uint8Array(samples.buffer);
 });
}

it('decodes a short clip once for three rates with independent transferable slices', async () => {
 audioFixture();
 const decoder = await openMusicDecoder(new Blob(['audio']), 'clip.wav');
 try {
  const first = await decoder.read(0, 10, 16000);
  expect(first).toHaveLength(160000);
  structuredClone(first, {transfer:[first.buffer]});
  expect(first.byteLength).toBe(0);
  const again = await decoder.read(0, 10, 16000);
  expect(again[1]).toBeCloseTo(.01);
  expect(await decoder.read(0, 60, 44100)).toHaveLength(441000);
  expect(await decoder.read(8, 10, 48000)).toHaveLength(96000);
  expect(await decoder.read(10, 10, 48000)).toHaveLength(0);
  expect(mock.exec).toHaveBeenCalledTimes(1);
 } finally { decoder.close(); }
 decoder.close();
 expect(mock.terminate).toHaveBeenCalledTimes(1);
 await expect(decoder.read(0, 10, 16000)).rejects.toThrow('closed');
});

it('shares an in-flight short decode between concurrent reads', async () => {
 audioFixture();
 const decoder = await openMusicDecoder(new Blob(['audio']), 'clip.wav');
 try {
  const [a,b] = await Promise.all([decoder.read(0,10,16000), decoder.read(0,10,48000)]);
  expect(a).toHaveLength(160000); expect(b).toHaveLength(480000);
  expect(mock.exec).toHaveBeenCalledTimes(1);
 } finally { decoder.close(); }
});

it('flushes codec tails at the thirty-second cache boundary without padding short audio', async () => {
 for (const [metadata, actual] of [[30,30], [10,9.99]]) {
  audioFixture(metadata, actual); mock.exec.mockClear();
  const decoder = await openMusicDecoder(new Blob(['audio']), 'clip.ogg');
  try {
   expect(await decoder.read(0, 60, 48000)).toHaveLength(Math.round(actual * 48000));
   expect(mock.exec.mock.calls[0][0]).toEqual(expect.arrayContaining(['-t','31']));
   expect(mock.exec).toHaveBeenCalledTimes(1);
  } finally { decoder.close(); }
 }
});

it('does not truncate unexpectedly long audio to the short-cache bound', async () => {
 audioFixture(30,31);
 const decoder = await openMusicDecoder(new Blob(['audio']), 'clip.wav');
 try {
  expect(await decoder.read(0, 60, 16000)).toHaveLength(31 * 16000);
  expect(mock.exec).toHaveBeenCalledTimes(2);
  expect(mock.exec.mock.calls[1][0]).toEqual(expect.arrayContaining(['-ss','0','-t','61']));
  await decoder.read(20, 10, 16000);
  expect(mock.exec).toHaveBeenCalledTimes(3);
 } finally { decoder.close(); }
});

it('keeps long and unknown recordings on bounded section decoding with codec lookahead', async () => {
 for (const duration of [120, 0]) {
  audioFixture(duration); mock.exec.mockClear();
  const decoder = await openMusicDecoder(new Blob(['audio']), 'song.wav');
  try {
   await decoder.read(0,10,16000); await decoder.read(20,10,16000);
   expect(mock.exec).toHaveBeenCalledTimes(2);
   expect(mock.exec.mock.calls[1][0]).toEqual(expect.arrayContaining(['-ss','20','-t','11']));
   expect(mock.exec.mock.calls[0][0]).not.toContain('-filter_complex');
  } finally { decoder.close(); }
 }
});

it('rejects cached reads after cancellation and fails closed on a partial multi-rate decode', async () => {
 audioFixture();
 const abort = new AbortController();
 const decoder = await openMusicDecoder(new Blob(['audio']), 'clip.wav', abort.signal);
 await decoder.read(0,10,16000); abort.abort();
 await expect(decoder.read(0,10,16000)).rejects.toMatchObject({name:'AbortError'});
 audioFixture();
 const readFile = mock.readFile.getMockImplementation()!;
 mock.readFile.mockImplementation(async (name: string) => {
  if (name === 'decoded-44100.f32') throw new Error('decode interrupted');
  return readFile(name);
 });
 const broken = await openMusicDecoder(new Blob(['audio']), 'broken.wav');
 try {
  await expect(broken.read(0,10,16000)).rejects.toThrow('decode interrupted');
  await expect(broken.read(0,10,16000)).rejects.toThrow('decode interrupted');
  expect(mock.exec).toHaveBeenCalledTimes(2); // one successful decoder, one failed decoder
 } finally { broken.close(); }
});

it('rejects in-flight short decode after abort instead of repopulating released PCM', async () => {
 audioFixture();
 const abort = new AbortController();
 const decoder = await openMusicDecoder(new Blob(['audio']), 'clip.wav', abort.signal);
 let finish!: (value: number) => void;
 mock.exec.mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve; }));
 const reading = decoder.read(0, 10, 16000);
 abort.abort(); finish(0);
 await expect(reading).rejects.toMatchObject({name:'AbortError'});
 await expect(decoder.read(0,10,48000)).rejects.toMatchObject({name:'AbortError'});
 expect(mock.terminate).toHaveBeenCalledTimes(1);
});
