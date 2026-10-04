// Post-build gate for release/win/run.exe: it must be a 64-bit PE whose SEA
// fuse is flipped, that carries the NODE_SEA_BLOB RCDATA resource (so Windows
// node.exe will find the launcher), and that still has the app icon after
// resedit rewrote the resource section. Fails loudly instead of shipping a
// Node binary that silently opens a REPL.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as ResEdit from 'resedit';

const exePath = path.resolve(process.argv[2] || 'release/win/run.exe');
const bytes = readFileSync(exePath);
const fail = (msg) => {
  console.error(`verify-win-exe: ${msg} (${exePath})`);
  process.exit(1);
};

if (bytes.subarray(0, 2).toString('latin1') !== 'MZ') fail('not a PE executable');
const peOffset = bytes.readUInt32LE(0x3c);
if (bytes.subarray(peOffset, peOffset + 4).toString('latin1') !== 'PE\0\0') fail('missing PE signature');
if (bytes.readUInt16LE(peOffset + 4) !== 0x8664) fail('not an x64 (AMD64) executable');
if (!bytes.includes('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1')) fail('SEA fuse not flipped — blob was not injected');

const exe = ResEdit.NtExecutable.from(bytes);
const res = ResEdit.NtExecutableResource.from(exe);
const RT_RCDATA = 10;
const blob = res.entries.find((e) => e.type === RT_RCDATA && e.id === 'NODE_SEA_BLOB');
if (!blob) fail('NODE_SEA_BLOB RCDATA resource missing — Windows Node will not find the launcher');
if (blob.bin.byteLength < 1024) fail(`NODE_SEA_BLOB is implausibly small (${blob.bin.byteLength} bytes)`);
const icons = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries).reduce((n, g) => n + g.icons.length, 0);
if (icons < 1) fail('no icon embedded');

console.log(
  `verify-win-exe: OK — x64 PE, SEA fuse on, NODE_SEA_BLOB ${(blob.bin.byteLength / 1024).toFixed(0)} kB, ${icons} icon(s), ${(bytes.length / 1048576).toFixed(1)} MB`,
);
