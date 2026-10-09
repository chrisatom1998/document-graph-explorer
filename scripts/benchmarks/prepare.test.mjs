import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import { isWithinDirectory } from './prepare.mjs';

for (const paths of [posix, win32]) {
  const directory = paths === win32 ? 'C:\\benchmark\\frozen' : '/benchmark/frozen';
  test(`preparation containment handles ${paths === win32 ? 'Windows' : 'POSIX'} paths`, () => {
    assert.equal(isWithinDirectory(directory, directory, paths), true);
    assert.equal(isWithinDirectory(directory, paths.join(directory, 'audio', 'clip.wav'), paths), true);
    assert.equal(isWithinDirectory(directory, paths.resolve(directory, '..', 'clip.wav'), paths), false);
    assert.equal(isWithinDirectory(directory, `${directory}-sibling${paths.sep}clip.wav`, paths), false);
    assert.equal(isWithinDirectory(directory, paths.join(directory, '..hidden', 'clip.wav'), paths), true);
  });
}
test('preparation accepts external Windows drives and UNC shares', () => {
  assert.equal(isWithinDirectory('C:\\frozen', 'D:\\audio\\clip.wav', win32), false);
  assert.equal(isWithinDirectory('\\\\server\\frozen', '\\\\server\\audio\\clip.wav', win32), false);
});
