import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { audioModelSourceUrls, DEFAULT_MODEL_MIRROR, downloadVerified } from './fetch-models.mjs';

const bytes = Buffer.from('discogs-effnet');
const hash = createHash('sha256').update(bytes).digest('hex');
const upstream = 'https://essentia.upf.edu/models/feature-extractors/discogs-effnet/discogs-effnet-bsdynamic-1.onnx';

function response(status, body = bytes) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async arrayBuffer() {
      return Uint8Array.from(body).buffer;
    },
  };
}

test('the mirror is tried before essentia and nested paths become release asset names', () => {
  const urls = audioModelSourceUrls('onnx/model.onnx', 'https://huggingface.co/org/model/resolve/rev/onnx/model.onnx', {});
  expect(urls).toEqual([
    `${DEFAULT_MODEL_MIRROR}/onnx__model.onnx`,
    'https://huggingface.co/org/model/resolve/rev/onnx/model.onnx',
  ]);
  expect(audioModelSourceUrls('discogs-effnet-bsdynamic-1.onnx', upstream, {})[0]).toBe(
    `${DEFAULT_MODEL_MIRROR}/discogs-effnet-bsdynamic-1.onnx`,
  );
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
    if (url.startsWith(DEFAULT_MODEL_MIRROR)) return response(url.endsWith('bad.onnx') ? 200 : 404, Buffer.from('nope'));
    return response(200);
  };
  const good = await downloadVerified(
    audioModelSourceUrls('discogs-effnet-bsdynamic-1.onnx', upstream, {}),
    hash,
    { fetch, wait: async () => {} },
  );
  expect(Buffer.from(good).toString()).toBe('discogs-effnet');
  expect(calls).toEqual([
    `${DEFAULT_MODEL_MIRROR}/discogs-effnet-bsdynamic-1.onnx`,
    upstream,
  ]);

  calls.length = 0;
  const mismatched = await downloadVerified(
    audioModelSourceUrls('bad.onnx', upstream, {}),
    hash,
    { fetch, wait: async () => {} },
  );
  expect(Buffer.from(mismatched).toString()).toBe('discogs-effnet');
  expect(calls).toEqual([`${DEFAULT_MODEL_MIRROR}/bad.onnx`, upstream]);
});

test('a good mirror is not followed by a fetch from the original host', async () => {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    return response(200);
  };
  await downloadVerified(audioModelSourceUrls('discogs-effnet-bsdynamic-1.onnx', upstream, {}), hash, {
    fetch,
    wait: async () => {},
  });
  expect(calls).toEqual([`${DEFAULT_MODEL_MIRROR}/discogs-effnet-bsdynamic-1.onnx`]);
});

test('network errors retry the mirror twice, then the original host', async () => {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    if (calls.length < 3) throw new Error('connect timeout');
    return response(200);
  };
  await downloadVerified(audioModelSourceUrls('discogs-effnet-bsdynamic-1.onnx', upstream, {}), hash, {
    fetch,
    wait: async () => {},
  });
  expect(calls).toEqual([
    `${DEFAULT_MODEL_MIRROR}/discogs-effnet-bsdynamic-1.onnx`,
    `${DEFAULT_MODEL_MIRROR}/discogs-effnet-bsdynamic-1.onnx`,
    upstream,
  ]);
});
