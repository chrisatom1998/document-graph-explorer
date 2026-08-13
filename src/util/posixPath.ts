/**
 * POSIX-style path helpers shared by repo walking and import resolution.
 * Browser File System Access paths and webkit fullPaths are already slash-
 * separated; we still normalize backslashes from Windows desktop drops.
 */

export function posixNormalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
}

export function posixBasename(path: string): string {
  const normalized = posixNormalize(path);
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

export function posixDirname(path: string): string {
  const normalized = posixNormalize(path);
  const slash = normalized.lastIndexOf('/');
  return slash <= 0 ? '' : normalized.slice(0, slash);
}

export function posixJoin(left: string, right: string): string {
  const prefix = posixNormalize(left);
  const suffix = posixNormalize(right).replace(/^\.\//, '');
  if (!prefix) return suffix.replace(/^\//, '');
  if (!suffix) return prefix;
  return `${prefix}/${suffix.replace(/^\//, '')}`;
}

/** Resolve `./x` / `../x` against a file path, returning a repo-relative posix path. */
export function posixResolveFrom(fromFilePath: string, specifier: string): string {
  const fromDir = posixDirname(fromFilePath);
  const spec = posixNormalize(specifier);
  // A leading slash is corpus/repository-root-relative. It must not inherit
  // the importing file's directory (`/docs/x` from `src/a.ts` is `docs/x`,
  // not `src/docs/x`). Consumers that retain a picked folder's display-name
  // prefix can add that prefix after this root-relative resolution.
  const fromParts = spec.startsWith('/') ? [] : fromDir ? fromDir.split('/') : [];
  const parts = fromParts.concat(spec.split('/'));
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

export function stripKnownExtension(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,8}$/, '');
}
