const fs=require('node:fs'),cp=require('node:child_process');
const repo=process.cwd()+'/';
const ort=require(repo+'node_modules/onnxruntime-node');
const wasm=require(repo+'node_modules/essentia.js/dist/essentia-wasm.umd.js');
const Essentia=require(repo+'node_modules/essentia.js/dist/essentia.js-core.umd.js');
const e=new Essentia(wasm);
const root=repo+'public/jamendo-model/';
const output=repo+'artifacts/music-evaluation/jamendo/';fs.mkdirSync(output,{recursive:true});
const metadata=JSON.parse(fs.readFileSync(root+'mtg_jamendo_instrument-discogs-effnet-1.json'));
(async()=>{
 const embed=await ort.InferenceSession.create(root+'discogs-effnet-bsdynamic-1.onnx',{intraOpNumThreads:2});
 const head=await ort.InferenceSession.create(root+'mtg_jamendo_instrument-discogs-effnet-1.onnx',{intraOpNumThreads:2});
 const dir=(process.argv[2]||'').replace(/\/$/,'')+'/';
 if(!process.argv[2])throw Error('Usage: node scripts/evaluate-jamendo.cjs <folder of WAV files>');
 const files=fs.readdirSync(dir).filter(n=>n.endsWith('.wav')).sort().map((name,i)=>({name,anonymous:`clip${i}`,path:dir+name,expected:'synthesizer'}));
 for(const name of ['trumpet','piano','drums'].filter(n=>fs.existsSync(repo+'artifacts/music-evaluation/'+n+'.ogg')))files.push({name,anonymous:'control-'+name,path:repo+'artifacts/music-evaluation/'+name+'.ogg',expected:name});
 const results=[];
 for(const f of files){
  const t=Date.now();
  const b=cp.execFileSync(process.env.FFMPEG_PATH || 'ffmpeg',['-v','error','-i',f.path,'-t','60','-ac','1','-ar','16000','-f','f32le','pipe:1'],{maxBuffer:8000000});
  const samples=new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  const frames=1+Math.ceil((samples.length-256)/256);const mel=new Float32Array(frames*96);
  for(let i=0;i<frames;i++){const frame=new Float32Array(512),start=i*256-256;for(let j=0;j<512;j++)if(start+j>=0&&start+j<samples.length)frame[j]=samples[start+j];const v=e.arrayToVector(frame);const {bands}=e.TensorflowInputMusiCNN(v);mel.set(e.vectorToArray(bands),i*96);bands.delete();v.delete();}
  const patches=[];for(let start=0;start+128<=frames;start+=62)patches.push(mel.slice(start*96,(start+128)*96));
  const scores=new Float64Array(40);const perPatch=[];
  for(const patch of patches){const {embeddings}=await embed.run({melspectrogram:new ort.Tensor('float32',patch,[1,128,96])});const {activations}=await head.run({embeddings});perPatch.push(Array.from(activations.data));for(let i=0;i<40;i++)scores[i]+=activations.data[i]/patches.length;}
  const ranking=metadata.classes.map((label,i)=>({label,score:scores[i]})).sort((a,b)=>b.score-a.score);
  const r={name:f.name,anonymous:f.anonymous,expected:f.expected,seconds:samples.length/16000,patches:patches.length,ranking,perPatch,milliseconds:Date.now()-t};results.push(r);console.log(JSON.stringify({name:f.name,top:ranking.slice(0,5),synthRank:ranking.findIndex(r=>r.label==='synthesizer')+1,ms:r.milliseconds}));fs.writeFileSync(output+'results.json',JSON.stringify({model:metadata.name,preprocessing:'16kHz mono; centered 512-sample frames, hop256; Essentia TensorflowInputMusiCNN; 128-frame patches, hop62; average all complete patch predictions',results},null,2));
 }
 await embed.release();await head.release();
})();
