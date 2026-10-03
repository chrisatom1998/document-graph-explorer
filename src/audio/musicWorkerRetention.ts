/** Four bounded family sessions retain ~190MB of pinned quantized weights, plus runtime buffers.
 * Reported low-memory or <=2thread hosts keep the previous one-session fallback. */
export function musicWorkerCapacity(memoryGB?: number, hardwareThreads?: number): number {
 if (typeof memoryGB==='number' && Number.isFinite(memoryGB) && memoryGB<8) return 1;
 if (typeof hardwareThreads==='number' && Number.isFinite(hardwareThreads) && hardwareThreads<=2) return 1;
 if (typeof memoryGB==='number' && memoryGB>=8 || typeof hardwareThreads==='number' && hardwareThreads>=8) return 4;
 return 1;
}
