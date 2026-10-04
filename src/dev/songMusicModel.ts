import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import type * as Ort from 'onnxruntime-node';
import {jamendoPatches} from '../audio/jamendoFeatures';
const require=createRequire(import.meta.url);
/** Native runner for the same bundled music model and preprocessing used in the browser. */
export async function loadSongMusicModel(){
 const ort=require('onnxruntime-node') as typeof Ort;
 const wasm=require('essentia.js/dist/essentia-wasm.umd.js');
 const Essentia=require('essentia.js/dist/essentia.js-core.umd.js');
 const engine=new Essentia(wasm) as Parameters<typeof jamendoPatches>[0];
 const root='public/jamendo-model/';
 const {classes}=JSON.parse(await readFile(root+'mtg_jamendo_instrument-discogs-effnet-1.json','utf8')) as {classes:string[]};
 const embed=await ort.InferenceSession.create(root+'discogs-effnet-bsdynamic-1.onnx',{intraOpNumThreads:2});
 let head:Ort.InferenceSession;
 try{head=await ort.InferenceSession.create(root+'mtg_jamendo_instrument-discogs-effnet-1.onnx',{intraOpNumThreads:2});}catch(e){await embed.release();throw e;}
 return {
  async classify(samples:Float32Array):Promise<Record<string,number>>{
   const patches=jamendoPatches(engine,samples),sums=new Float64Array(classes.length);
   for(const patch of patches){
    const input=new ort.Tensor('float32',patch,[1,128,96]);
    const embedding=await embed.run({melspectrogram:input});
    try{
     const result=await head.run({embeddings:embedding.embeddings});
     try{for(let i=0;i<sums.length;i++)sums[i]+=Number(result.activations.data[i])/patches.length;}
     finally{for(const t of Object.values(result))t.dispose();}
    }finally{input.dispose();for(const t of Object.values(embedding))t.dispose();}
   }
   return Object.fromEntries(classes.map((c,i)=>[c,sums[i]]));
  },
  async dispose(){await embed.release();await head.release();}
 };
}
