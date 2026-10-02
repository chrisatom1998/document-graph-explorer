import { mkdir, copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const target = 'public/audio-runtime';
await mkdir(target, { recursive: true });
for (const name of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  await copyFile(join('node_modules/@ffmpeg/core/dist/esm', name), join(target, name));
}
for (const name of await readdir('node_modules/@ffmpeg/ffmpeg/dist/esm')) {
  if (name.endsWith('.js')) await copyFile(join('node_modules/@ffmpeg/ffmpeg/dist/esm', name), join(target, name));
}

// All runtime fetches must stay on the application origin, including fallback paths.
for (const name of ['ffmpeg-wrapper-MIT.txt', 'ffmpeg-core-GPLv2.txt']) {
  await copyFile(join('scripts/licenses', name), join(target, name));
}

const constants = join(target, 'const.js');
const source = await readFile(constants, 'utf8');
await writeFile(constants, source.replace(/export const CORE_URL =[^;]+;/, 'export const CORE_URL = new URL("./ffmpeg-core.js", import.meta.url).href;'));
await writeFile(join(target, 'NOTICE.txt'), [
  'Audio conversion uses @ffmpeg/core 0.12.10 (GPL-2.0-or-later) and @ffmpeg/ffmpeg (MIT).',
  'Core version 0.12.10 source/build scripts: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10',
  'Wrapper version 0.12.15 source: https://github.com/ffmpegwasm/ffmpeg.wasm',
  'Retain the accompanying MIT and GPL license texts when distributing this runtime.',
  'FFmpeg source and licensing: https://ffmpeg.org/legal.html',
  'Original audio files are never sent to these URLs.',
  '',
].join('\n'));
