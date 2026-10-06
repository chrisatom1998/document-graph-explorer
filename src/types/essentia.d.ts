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
    OnsetDetectionGlobal(data: Vector, frameSize?: number, hopSize?: number, method?: string, sampleRate?: number): { onsetDetections: Vector };
    LoopBpmEstimator(data: Vector, confidenceThreshold?: number): { bpm: number };
    TensorflowInputMusiCNN(data: Vector): { bands: Vector };
    KeyExtractor(data: Vector, averageDetuningCorrection?: boolean, frameSize?: number, hopSize?: number, hpcpSize?: number, maxFrequency?: number, maximumSpectralPeaks?: number, minFrequency?: number, pcpThreshold?: number, profileType?: string): { key: string; scale: string; strength: number };
    Windowing(data: Vector, normalized?: boolean, size?: number, type?: string): { frame: Vector };
    Spectrum(data: Vector, size?: number): { spectrum: Vector };
    SpectralPeaks(data: Vector, magnitudeThreshold?: number, maxFrequency?: number, maxPeaks?: number, minFrequency?: number, orderBy?: string, sampleRate?: number): { frequencies: Vector; magnitudes: Vector };
    SpectralWhitening(spectrum: Vector, frequencies: Vector, magnitudes: Vector, maxFrequency?: number, sampleRate?: number): { magnitudes: Vector };
    HPCP(frequencies: Vector, magnitudes: Vector, bandPreset?: boolean, bandSplitFrequency?: number, harmonics?: number, maxFrequency?: number, maxShifted?: boolean, minFrequency?: number, nonLinear?: boolean, normalized?: string, referenceFrequency?: number, sampleRate?: number, size?: number, weightType?: string, windowSize?: number): { hpcp: Vector };
    Key(pcp: Vector, numHarmonics?: number, pcpSize?: number, profileType?: string, slope?: number, useMajMin?: boolean, usePolyphony?: boolean, useThreeChords?: boolean): { key: string; scale: string; strength: number; firstToSecondRelativeStrength: number };
    delete(): void;
  }
}
