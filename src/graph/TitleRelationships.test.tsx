// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useGraphStore } from '../store/graphStore';
import TitleRelationships from './TitleRelationships';
vi.mock('../layout/layoutBridge',()=>({layoutReheat:vi.fn(),layoutSetLinks:vi.fn()}));
afterEach(()=>{cleanup();useGraphStore.getState().reset();});
it('upgrades open collections, responds to renames, and retains manual connections',()=>{
 const nodes=['a','b'].map(id=>({id,title:`Melodic Loop ${id}`,kind:'document' as const,fileType:'md' as const,topics:[],entities:[],keywords:[],wordCount:0,degree:0,cluster:0,status:'ok' as const}));
 const graph=useGraphStore.getState();graph.addNodes(nodes);graph.setEdges([{id:'manual',source:'a',target:'b',kind:'reference',authored:true,weight:1,evidence:['My link']}]);graph.setPhase('ready');
 render(<TitleRelationships />);
 expect(useGraphStore.getState().edges.map(e=>e.kind)).toEqual(['reference','title']);
 act(()=>useGraphStore.getState().patchNodes(new Map([['b',{title:'Drum Break'}]])));
 expect(useGraphStore.getState().edges.map(e=>e.id)).toEqual(['manual']);
});
it('removes title links between audio saved by older versions',()=>{
 const nodes=['a','b'].map(id=>({id,title:`Melodic Loop ${id}`,kind:'document' as const,fileType:'audio' as const,topics:[],entities:[],keywords:[],wordCount:0,degree:0,cluster:0,status:'ok' as const}));
 const graph=useGraphStore.getState();graph.addNodes(nodes);graph.setEdges([{id:'a->b:title',source:'a',target:'b',kind:'title',weight:.7,evidence:['Shared title phrase: “melodic loop”.']}]);graph.setPhase('ready');
 render(<TitleRelationships />);
 expect(useGraphStore.getState().edges).toEqual([]);
});
