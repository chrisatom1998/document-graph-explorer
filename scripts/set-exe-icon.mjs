// Injects the app icon (and version metadata) into the SEA-built Windows
// executable (scripts/build-win-exe.mjs). The base binary is the official
// node.exe, which carries Node's own icon/metadata and an Authenticode
// signature that the blob injection has already invalidated; resedit parses
// it with `ignoreCert` and `generate()` emits an unsigned executable, which is
// what Node's SEA guide prescribes (remove the signature, then re-sign if you
// have a certificate). Other resource editors (rcedit, Resource Hacker) are
// known to corrupt Node binaries, so this project standardizes on resedit.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ResEdit from 'resedit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const exePath = path.resolve(repoRoot, process.argv[2] || 'release/win/run.exe');
const iconPath = path.join(repoRoot, 'packaging', 'document-graph-explorer.ico');
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

const LANG = 1033; // en-US
const CODEPAGE = 1200; // Unicode

function versionParts(version) {
  const [major = 0, minor = 0, patch = 0] = String(version)
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  return [major, minor, patch, 0];
}

function main() {
  const exeData = readFileSync(exePath);
  const exe = ResEdit.NtExecutable.from(exeData, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(readFileSync(iconPath));
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1,
    LANG,
    iconFile.icons.map((icon) => icon.data),
  );

  const [major, minor, patch, build] = versionParts(pkg.version);
  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = viList.length > 0 ? viList[0] : ResEdit.Resource.VersionInfo.createEmpty();
  vi.setFileVersion(major, minor, patch, build, LANG);
  vi.setProductVersion(major, minor, patch, build, LANG);
  vi.setStringValues(
    { lang: LANG, codepage: CODEPAGE },
    {
      FileDescription: 'Document Graph Explorer',
      ProductName: 'Document Graph Explorer',
      CompanyName: 'Document Graph Explorer',
      FileVersion: pkg.version,
      ProductVersion: pkg.version,
      OriginalFilename: path.basename(exePath),
      LegalCopyright: `Copyright (c) ${new Date().getFullYear()} Document Graph Explorer`,
    },
  );
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`Embedded icon + metadata into ${path.relative(repoRoot, exePath)}`);
}

main();
