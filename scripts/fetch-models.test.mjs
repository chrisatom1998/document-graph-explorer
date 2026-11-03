import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { audioModelSourceUrls, downloadVerified } from './fetch-models.mjs';

const bytes = Buffer.from('discogs-effnet');
const hash = createHash('sha256').update(bytes).digest('hex');
const upstream = 'https://essentia.upf.edu/models/feature-extractors/discogs-effnet/discogs-effnet-bsdynamic-1.onnx';
const mirror = 'https://github.com/chrisatom1998/document-graph-explorer/releases/download/models-v1';
const mirrorEnv = { DGE_MODEL_MIRROR: mirror };

function response(status, body = bytes) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async arrayBuffer() {
      return Uint8Array.from(body).buffer;
    },
  };
}

test('the mirror is used only when CI sets it, and nested paths become release asset names', () => {
  const huggingface = 'https://huggingface.co/org/model/resolve/rev/onnx/model.onnx';
  expect(audioModelSourceUrls('onnx/model.onnx', huggingface, {})).toEqual([huggingface]);
  expect(audioModelSourceUrls('discogs-effnet-bsdynamic-1.onnx', upstream, {})).toEqual([upstream]);
  expect(audioModelSourceUrls('onnx/model.onnx', huggingface, mirrorEnv)).toEqual([
    `${mirror}/onnx__model.onnx`,
    huggingface,
  ]);
});

test('an empty mirror leaves the manifest host as the only source', () => {
  expect(audioModelSourceUrls('discogs-effnet-bsdynamic-1.onnx', upstream, { DGE_MODEL_MIRROR: '' })).toEqual([
    upstream,
  ]);
});

test('a missing or corrupt mirror falls through to the original host and the checksum still wins', async () => {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    if (url.startsWith(mirror)) return response(url.endsWith('bad.onnx') ? 200 : 404, Buffer.from('nope'));
    return response(200);
  };
  const good = await downloadVerified(
    audioModelSourceUrls('discogs-effnet-bsdynamic-1.onnx', upstream, mirrorEnv),
    hash,
    { fetch, wait: async () => {} },
  );
  expect(Buffer.from(good).toString()).toBe('discogs-effnet');
  expect(calls).toEqual([
    `${mirror}/discogs-effnet-bsdynamic-1.onnx`,
    upstream,
  ]);

  calls.length = 0;
  const mismatched = await downloadVerified(
    audioModelSourceUrls('bad.onnx', upstream, mirrorEnv),
    hash,
    { fetch, wait: async () => {} },
  );
  expect(Buffer.from(mismatched).toString()).toBe('discogs-effnet');
  expect(calls).toEqual([`${mirror}/bad.onnx`, upstream]);
});

test('a good mirror is not followed by a fetch from the original host', async () => {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    return response(200);
  };
  await downloadVerified(audioModelSourceUrls('discogs-effnet-bsdynamic-1.onnx', upstream, mirrorEnv), hash, {
    fetch,
    wait: async () => {},
  });
  expect(calls).toEqual([`${mirror}/discogs-effnet-bsdynamic-1.onnx`]);
});

test('network errors retry the mirror twice, then the original host', async () => {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    if (calls.length < 3) throw new Error('connect timeout');
    return response(200);
  };
  await downloadVerified(audioModelSourceUrls('discogs-effnet-bsdynamic-1.onnx', upstream, mirrorEnv), hash, {
    fetch,
    wait: async () => {},
  });
  expect(calls).toEqual([
    `${mirror}/discogs-effnet-bsdynamic-1.onnx`,
    `${mirror}/discogs-effnet-bsdynamic-1.onnx`,
    upstream,
  ]);
});
