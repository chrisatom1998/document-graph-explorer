declare module 'essentia.js/dist/essentia-wasm.es.js' {
  export const EssentiaWASM: { calledRun?: boolean; onRuntimeInitialized?: () => void };
}
declare module 'essentia.js/dist/essentia.js-core.es.js' {
  interface Vector { delete(): void; size(): number; get(index: number): number; }
  export default class Essentia {
    constructor(wasm: unknown);
    arrayToVector(data: Float32Array): Vector;
    vectorToArray(data: Vector): Float32Array;
    RhythmExtractor2013(data: Vector): { bpm: number; confidence: number; ticks: Vector; estimates: Vector; bpmIntervals: Vector };
    PitchYin(data: Vector, frameSize?: number, interpolate?: boolean, maxFrequency?: number, minFrequency?: number): { pitch: number; pitchConfidence: number };
    OnsetRate(data: Vector): { onsets: Vector; onsetRate: number };
    LoopBpmEstimator(data: Vector, confidenceThreshold?: number): { bpm: number };
    TensorflowInputMusiCNN(data: Vector): { bands: Vector };
    KeyExtractor(data: Vector): { key: string; scale: string; strength: number };
    Windowing(data: Vector): { frame: Vector };
    Spectrum(data: Vector): { spectrum: Vector };
    SpectralPeaks(data: Vector): { frequencies: Vector; magnitudes: Vector };
    HPCP(frequencies: Vector, magnitudes: Vector): { hpcp: Vector };
    delete(): void;
  }
}
