// Kept in its own tiny module: the settings store is in the app entry chunk, and djTags pulls in the whole catalog.
/** Settings switch (Chris, 2026-11-02): when off, tags in DJ_HIDDEN_LABELS (djTags.ts) stop showing on clips as model estimates
 * (tags a listener confirmed by hand still show). On by default, which keeps the long-standing behaviour: hidden tags
 * are only left out of the picker list. The settings store sets this on load and on every change. */
let hiddenSoundTagsShown = true;
export function setHiddenSoundTagsShown(show: boolean): void { hiddenSoundTagsShown = show; }
export function areHiddenSoundTagsShown(): boolean { return hiddenSoundTagsShown; }
