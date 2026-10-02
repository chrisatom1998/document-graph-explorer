import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { makeEssentiaCspSafe } from '../../scripts/essentia-csp';

const original = readFileSync('node_modules/essentia.js/dist/essentia-wasm.es.js', 'utf8');
const safe = makeEssentiaCspSafe(original);

function glue(start: string, end: string) {
  return safe.slice(safe.indexOf(start), safe.indexOf(end, safe.indexOf(start)));
}
const wrappers = [
  glue('function createNamedFunction(', 'function extendError('),
  glue('function embind__requireFunction(', 'var UnboundTypeError='),
  glue('function craftEmvalAllocator(', 'var emval_newers='),
].join('\n');

describe('Essentia under the production content security policy', () => {
  it('preserves receivers, native calls and constructor argument decoding without eval', () => {
    const result = runInNewContext(`${wrappers}
      const named = createNamedFunction('binding', function(value) { return this.offset + value; });
      const native = embind__requireFunction('iii', 42);
      class Pair { constructor(a, b) { this.values = [a, b]; } }
      const pair = craftEmvalAllocator(2)(Pair, 0, 100);
      [named.call({ offset: 5 }, 7), named.name, native(3, 4, 999), pair.values];
    `, {
      makeLegalFunctionName: (name: string) => name,
      readLatin1String: (value: string) => value,
      Module: { HEAP32: [1, 2], dynCall_iii: (...args: number[]) => args },
      throwBindingError: (message: string) => { throw new Error(message); },
      requireRegisteredType: (type: number) => ({
        argPackAdvance: type * 4,
        readValueFromPointer: (pointer: number) => pointer + type,
      }),
      __emval_register: (value: unknown) => value,
    }, { contextCodeGeneration: { strings: false, wasm: true } });
    expect(result).toEqual([12, 'binding', [42, 3, 4], [101, 106]]);
  });

  it('removes dynamic compilation from the actual bundled dependency', () => {
    expect(safe).not.toMatch(/\bnew\s+Function\s*\(|\bnew_\(Function\s*,|\beval\s*\(/);
    expect(original).toContain('new Function(');
  });

  it('initializes the real WASM module and exercises native vector bindings without eval', async () => {
    let runtime!: {
      arrayToVector: (values: Float32Array) => { delete: () => void };
      vectorToArray: (vector: { delete: () => void }) => Float32Array;
      EssentiaJS: new (debug: boolean) => { RMS: (vector: unknown) => { rms: number }; delete: () => void };
    };
    const initialized = new Promise<void>((resolve, reject) => {
      const module = { onRuntimeInitialized: resolve, onAbort: reject };
      const context = { Module: module, console, setTimeout, clearTimeout, atob };
      runInNewContext(safe.replace('export { Module as EssentiaWASM };', ''), context,
        { contextCodeGeneration: { strings: false, wasm: true } });
      runtime = context.Module as unknown as typeof runtime;
    });
    await initialized;
    const vector = runtime.arrayToVector(new Float32Array([1, 2, 3]));
    expect(Array.from(runtime.vectorToArray(vector))).toEqual([1, 2, 3]);
    const engine = new runtime.EssentiaJS(false);
    expect(engine.RMS(vector).rms).toBeCloseTo(Math.sqrt(14 / 3));
    engine.delete();
    vector.delete();
  });

  it('requires review when the upstream glue changes', () => {
    expect(() => makeEssentiaCspSafe(original.replace('function craftEmvalAllocator(', 'function changedAllocator('))).toThrow('needs review');
  });
});
