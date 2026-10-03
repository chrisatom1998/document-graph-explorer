import {it,expect} from 'vitest';
import {musicWorkerCapacity} from './musicWorkerRetention';
it('retains the bounded family set on reported >=8GB or high-thread hosts',()=>{expect(musicWorkerCapacity(16,4)).toBe(4);expect(musicWorkerCapacity(8,8)).toBe(4);expect(musicWorkerCapacity(undefined,18)).toBe(4);});
it('preserves the small-host or unresolved-device fallback',()=>{for(const [m,c] of [[4,18],[16,2],[undefined,4],[undefined,undefined],[NaN,NaN]])expect(musicWorkerCapacity(m,c)).toBe(1);});
