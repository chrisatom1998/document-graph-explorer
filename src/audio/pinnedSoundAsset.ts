/** An absent optional model is allowed; a shipped model that cannot load is a
 * failed analysis, never a successful fallback that may enter the result cache. */
export async function loadPinnedSoundAsset(name: string, hash: string | undefined): Promise<unknown> {
 if (!hash) return undefined;
 const response = await fetch(`${import.meta.env.BASE_URL}sound-model/${name}?v=${hash.slice(0, 12)}`, {cache:'no-cache', signal:AbortSignal.timeout(15_000)});
 if (!response.ok) throw new Error(`Sound model ${name} could not be loaded. Reanalyze to retry.`);
 const bytes = await response.arrayBuffer();
 const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
 if (actual !== hash) throw new Error(`Sound model ${name} failed verification. Reanalyze to retry.`);
 return JSON.parse(new TextDecoder().decode(bytes));
}
