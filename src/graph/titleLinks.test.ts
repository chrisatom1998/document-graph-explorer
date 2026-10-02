import { expect, it } from 'vitest';
import { buildTitleEdges, titlePhrases } from './titleLinks';
import type { DocNode } from '../model/types';
import { sanitizeGraphExport } from '../persistence/validateImport';
const node = (id: string, title: string): DocNode => ({ id, title, kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok' });
it('links every small-group pair by melodic loop even without audio analysis', () => {
 const nodes = Array.from({length:7},(_,i)=>node(String(i),`SHADOW_UK1_Melodic_Loop_Clip${i}_${i%2?'Dm_140':'D#m_130'}.wav`));
 const edges=buildTitleEdges(nodes);
 expect(edges).toHaveLength(21);
 expect(edges.every(e=>e.evidence.includes('Shared title phrase: “melodic loop”.'))).toBe(true);
 expect(new Set(edges.map(e=>e.id)).size).toBe(21);
 expect(sanitizeGraphExport({version:1,nodes,edges}).edges.every(e=>e.kind==='title')).toBe(true);
});
it('normalizes case, separators and plurals, without matching pack IDs or musical metadata', () => {
 expect(titlePhrases('SHADOW_UK1_Melodic_Loops_D#m_130.wav')).toEqual(['melodic loop']);
 expect(buildTitleEdges([node('a','SHADOW_UK1_Melodic_Loop_Dm_140'),node('b','SHADOW_UK1_Bass_Loop_Dm_140')])).toEqual([]);
 expect(buildTitleEdges([node('a','same filename'),node('b','same filename')])).toEqual([]);
});
it('also links ordinary documents and updates after renaming', () => {
 const a={...node('a','Project Plan Alpha'),fileType:'txt' as const};
 const b={...node('b','project-plan-beta'),fileType:'txt' as const};
 expect(buildTitleEdges([a,b])).toHaveLength(1);
 expect(buildTitleEdges([a,{...b,title:'Meeting Notes'}])).toEqual([]);
});
it('keeps large title groups connected with bounded, deterministic edges', () => {
 const nodes=Array.from({length:100},(_,i)=>node(String(i),'Melodic Loops'));
 const edges=buildTitleEdges(nodes);
 expect(edges).toHaveLength(300);
 expect(buildTitleEdges([...nodes].reverse())).toEqual(edges);
 const visited=new Set(['0']);
 for(let i=0;i<nodes.length;i++) for(const e of edges) if(visited.has(e.source)||visited.has(e.target)){visited.add(e.source);visited.add(e.target);}
 expect(visited.size).toBe(100);
});
