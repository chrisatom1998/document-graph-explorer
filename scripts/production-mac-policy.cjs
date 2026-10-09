// Pure release policy shared by the workflow and dependency-free tests.
const REPOSITORY = 'chrisatom1998/document-graph-explorer';
const VERCEL_BOT_ID = 35613825;
const ASSETS = ['Document-Graph-Explorer-mac-arm64.dmg', 'Document-Graph-Explorer-mac-x64.dmg',
  'SHA256SUMS-arm64.txt', 'SHA256SUMS-x64.txt', 'BUILD-INFO-arm64.txt', 'BUILD-INFO-x64.txt'];
function validateEvent(event) {
  const d = event.deployment, s = event.deployment_status;
  if (event.repository?.full_name !== REPOSITORY || event.repository?.private !== false ||
      d?.environment !== 'Production' || s?.environment !== 'Production' || s?.state !== 'success' ||
      d?.creator?.id !== VERCEL_BOT_ID || s?.creator?.id !== VERCEL_BOT_ID ||
      !/^[0-9a-f]{40}$/.test(d?.sha ?? '') || !Number.isSafeInteger(d?.id) ||
      !Number.isSafeInteger(s?.id)) throw new Error('Not a trusted public DGE production success');
  // Vercel currently emits production_environment=false even for Production.
  const target = new URL(s.environment_url);
  if (target.protocol !== 'https:' || !/^document-graph-explorer-[a-z0-9]+-chris-s-projects-f12cde19\.vercel\.app$/.test(target.hostname))
    throw new Error('Unexpected production deployment project');
  return { sha: d.sha, tag: `mac-${d.sha}`, statusId: s.id, deploymentId: d.id };
}
function assertComplete(assets) {
  for (const name of ASSETS) {
    const matches = assets.filter(a => a.name === name && a.state === 'uploaded' && a.size > 0);
    if (matches.length !== 1 || matches[0].size >= 2 ** 31) throw new Error(`Missing or invalid release asset: ${name}`);
  }
}
function pointerStatus(body) {
  const id = /<!-- production-status:(\d+) -->/.exec(body ?? '')?.[1];
  return id ? Number(id) : 0;
}
function releaseBody(sha) {
  return `Mac build of production source ${sha}.\n\nApple Silicon and Intel DMGs are built and startup-tested on their native macOS runners.\n\nThese builds are ad-hoc signed, without an Apple Developer ID certificate or notarization. macOS may block the first launch; only open this app if you trust its source. No automatic updater is configured.\n\nSee the attached per-architecture SHA256SUMS and BUILD-INFO files.`;
}
function pointerBody(meta) {
  const base = `https://github.com/${REPOSITORY}/releases/download/${meta.tag}`;
  return `# Download Document Graph Explorer for Mac\n\n` +
    `[Apple Silicon (M1/M2/M3/M4 or newer)](${base}/${ASSETS[0]})\n\n` +
    `[Intel Mac](${base}/${ASSETS[1]})\n\n` +
    `Source: [${meta.sha.slice(0, 12)}](https://github.com/${REPOSITORY}/commit/${meta.sha})\n\n` +
    `[Checksums and build details](https://github.com/${REPOSITORY}/releases/tag/${meta.tag})\n\n` +
    `Ad-hoc signed; not Apple Developer ID signed or notarized. macOS may block first launch. Only open it if you trust the source.\n\n` +
    `Updated after both architectures build and pass startup checks. If a new build fails, these last successful downloads remain available.\n\n` +
    `<!-- production-status:${meta.statusId} -->`;
}
module.exports = { REPOSITORY, VERCEL_BOT_ID, ASSETS, validateEvent, assertComplete, pointerStatus, releaseBody, pointerBody };
