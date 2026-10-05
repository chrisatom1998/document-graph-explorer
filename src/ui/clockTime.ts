/** Minutes:seconds, or tenths of a second for anything under one second, so a 0.43 s one-shot reads "0.4 s"
 * instead of "0:00" (which looked like nothing was analyzed). `scale` lets a position share its track's format. */
export const clockTime = (seconds: number, scale = seconds): string =>
  Number.isFinite(scale) && scale > 0 && scale < 1
    ? `${(Math.max(0, seconds)).toFixed(1)} s`
    : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
