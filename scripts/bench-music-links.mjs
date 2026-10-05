import { buildMusicEdges, MUSIC_NEIGHBOR_LIMIT } from '../src/audio/musicLinks';
for (const size of [100, 1000, 5000]) {
  const nodes = Array.from({length:size},(_,i)=>({id:`clip-${String(i).padStart(6,'0')}`,title:'Sample',kind:'document',fileType:'audio',topics:[],entities:[],keywords:[],wordCount:0,degree:0,cluster:0,status:'ok',audio:{version:2,durationSeconds:8,analyzedSeconds:8,notes:[],instruments:[],tempo:{bpm:80+i%101,confidence:.9},key:{tonic:i%12,mode:i%2?'major':'minor',strength:.85},confirmedInstruments:[['piano','synthesizer','voice','drum kit'][i%4]],confirmedDjTags:{source:[],production:[],character:[['metallic','warm','bright'][i%3]]}}}));
  const start=performance.now(); const edges=buildMusicEdges(nodes); const ms=performance.now()-start;
  const neighbors=new Map();
  for(const edge of edges)for(const [a,b] of [[edge.source,edge.target],[edge.target,edge.source]]){const set=neighbors.get(a)??new Set();set.add(b);neighbors.set(a,set);}
  const maxDegree=Math.max(...[...neighbors.values()].map(s=>s.size));
  if(maxDegree>MUSIC_NEIGHBOR_LIMIT)throw Error('Unbounded graph');
  console.log(JSON.stringify({nodes:size,edges:edges.length,ms:Math.round(ms),maxNeighbors:maxDegree,connectedNodes:neighbors.size}));
}
