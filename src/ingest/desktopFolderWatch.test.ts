// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { armDesktopFolderWatch, deriveRootPath, disarmDesktopFolderWatch } from './desktopFolderWatch';
import type { NamedFile } from './localFiles';

function entry(path: string): NamedFile {
  return { file: new File(['x'], path.split('/').pop() ?? 'f'), path };
}

function installBridge(overrides: Partial<NonNullable<Window['desktopBridge']>> = {}) {
  const bridge = {
    getPathForFile: vi.fn().mockReturnValue('/Users/me/notes/sub/a.md'),
    watchFolder: vi.fn().mockResolvedValue(true),
    unwatchFolder: vi.fn().mockResolvedValue(true),
    onFolderChanged: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
  window.desktopBridge = bridge;
  return bridge;
}

afterEach(async () => {
  await disarmDesktopFolderWatch();
  delete window.desktopBridge;
});

describe('deriveRootPath', () => {
  it('strips the root-relative suffix from the absolute file path', () => {
    installBridge();
    expect(deriveRootPath('notes', entry('notes/sub/a.md'))).toBe('/Users/me/notes');
  });

  it('accepts Windows separators in the absolute path', () => {
    installBridge({
      getPathForFile: vi.fn().mockReturnValue('C:\\Users\\me\\notes\\sub\\a.md'),
    });
    expect(deriveRootPath('notes', entry('notes/sub/a.md'))).toBe('C:\\Users\\me\\notes');
  });

  it('refuses a mapping whose suffix does not match the relative path', () => {
    installBridge({ getPathForFile: vi.fn().mockReturnValue('/somewhere/else/entirely.md') });
    expect(deriveRootPath('notes', entry('notes/sub/a.md'))).toBeNull();
  });

  it('returns null outside the desktop shell', () => {
    expect(deriveRootPath('notes', entry('notes/sub/a.md'))).toBeNull();
  });
});

describe('armDesktopFolderWatch', () => {
  it('watches the derived root and re-arming the same folder is a no-op', async () => {
    const bridge = installBridge();
    const onChange = () => undefined;
    await armDesktopFolderWatch('c1', 'notes', [entry('notes/sub/a.md')], onChange);
    await armDesktopFolderWatch('c1', 'notes', [entry('notes/sub/a.md')], onChange);
    expect(bridge.watchFolder).toHaveBeenCalledExactlyOnceWith('/Users/me/notes');
    expect(bridge.onFolderChanged).toHaveBeenCalledOnce();
  });

  it('does nothing for an empty scan', async () => {
    const bridge = installBridge();
    await armDesktopFolderWatch('c1', 'notes', [], () => undefined);
    expect(bridge.watchFolder).not.toHaveBeenCalled();
  });

  it('disarming unsubscribes and stops the native watch', async () => {
    const unsubscribe = vi.fn();
    const bridge = installBridge({ onFolderChanged: vi.fn().mockReturnValue(unsubscribe) });
    await armDesktopFolderWatch('c1', 'notes', [entry('notes/sub/a.md')], () => undefined);
    await disarmDesktopFolderWatch();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(bridge.unwatchFolder).toHaveBeenCalled();
  });
});
