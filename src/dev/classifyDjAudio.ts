import { loadSongMusicModel } from './songMusicModel';
import { instrumentScores } from '../audio/instrumentLabels';
import { songInstrumentCandidates, songInstrumentTags, songMusicEvidence, type SongInstrumentCandidate } from '../audio/songRecognition';
import { songReviewStarts } from '../audio/analysisPlan';
import { learnedDjScores, sanitizeLearnedDjModel } from '../audio/learnedDjModel';
/** Run the app's category selector on local audio, without filename prompts or uploads.
 * Usage: npx vite-node src/dev/classifyDjAudio.ts -- <audio files>
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { env, AutoProcessor, AutoModelForAudioClassification, ClapAudioModelWithProjection } from '@huggingface/transformers';
import { descriptionScores, type DescriptionPrompt } from '../audio/profileDescriptions';
import { selectDjTags, DJ_CATALOG } from '../audio/djTags';
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : 'artifacts/music-evaluation/dj-catalog-smoke.json';
const paths = process.argv.slice(process.argv.indexOf('--') + 1).filter(p => /\.(wav|mp3|ogg|flac|aiff|m4a)$/i.test(p));
if (!paths.length) throw new Error('Pass local audio file paths after --. Requires FFmpeg on PATH.');
env.allowRemoteModels = false;
const manifest = JSON.parse(await readFile('public/sound-model/manifest.json', 'utf8'));
// The normal app setup already stages the frozen audio model here. Do not
// require a private research cache just to import a sound into the reviewer.
const repository = './public/sound-model';
const processor = await AutoProcessor.from_pretrained(repository, {local_files_only:true});
const model = await ClapAudioModelWithProjection.from_pretrained(repository, {dtype:'q8',local_files_only:true});
const prompts = JSON.parse(await readFile('public/sound-model/prompts.json','utf8')) as DescriptionPrompt[];
let learned: ReturnType<typeof sanitizeLearnedDjModel>;
// A private reviewed model is optional and must be explicitly pinned before use.
if(manifest.sha256?.['learned.json']) {
  try {
    const bytes=await readFile('public/sound-model/learned.json');
    if(createHash('sha256').update(bytes).digest('hex')!==manifest.sha256['learned.json'])throw Error('Reviewed model hash mismatch');
    learned=sanitizeLearnedDjModel(JSON.parse(bytes.toString('utf8')));
  } catch { console.warn('Optional reviewed model unavailable; using frozen base models.'); }
}
const songMode = process.argv.includes('--song');
const instruments = songMode ? await AutoModelForAudioClassification.from_pretrained('./public/music-model',{dtype:'q8',local_files_only:true}) : null;
const instrumentProcessor = songMode ? await AutoProcessor.from_pretrained('./public/music-model',{local_files_only:true}) : null;
const musicModel = songMode ? await loadSongMusicModel() : null;
const report: {file:string; start:number; duration:number; seconds:number; tags:ReturnType<typeof selectDjTags>; instrumentCandidates:SongInstrumentCandidate[]; embedding:number[]; properties:{durationSeconds:number; sampleRate:number; rmsDbfs:number|null; peakDbfs:number|null; zeroCrossingRate:number}}[] = [];
try {
  for (const path of paths) {
    const duration = Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',path],{encoding:'utf8'}).trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Cannot determine audio duration');
    for (const start of songMode ? songReviewStarts(duration) : [0]) {
    const bytes = execFileSync('ffmpeg',['-v','error','-ss',String(start),'-i',path,'-t','10','-ac','1','-ar','48000','-f','f32le','pipe:1'],{maxBuffer:4_000_000});
    const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const energy = samples.reduce((sum,x)=>sum+x*x,0)/Math.max(1,samples.length);
    const embedding = energy > 1e-8 ? Array.from((await model(await processor(samples))).audio_embeds.data) as number[] : [];
    const tags = selectDjTags([...descriptionScores(embedding,prompts), ...(learned && learned.encoder === `${manifest.repository}@${manifest.revision}` ? learnedDjScores(embedding,learned) : [])]);
    let instrumentCandidates:SongInstrumentCandidate[]=[];
    if(instruments && instrumentProcessor && energy>1e-8){
      const pcm=execFileSync('ffmpeg',['-v','error','-ss',String(start),'-i',path,'-t','10','-ac','1','-ar','16000','-f','f32le','pipe:1'],{maxBuffer:1_000_000});
      const audio=new Float32Array(pcm.buffer.slice(pcm.byteOffset,pcm.byteOffset+pcm.byteLength));
      const output=await instruments(await instrumentProcessor(audio));
      const scores=instrumentScores(output.logits.data,(instruments.config as unknown as {id2label:Record<string,string>}).id2label);
      instrumentCandidates=songInstrumentCandidates(scores);
      tags.push(...songInstrumentTags(scores));
      if(musicModel){const evidence=songMusicEvidence(await musicModel.classify(audio));tags.push(...evidence.tags);instrumentCandidates.push(...evidence.candidates);}
    }
    let peak=0,crossings=0;
    for(let i=0;i<samples.length;i++){peak=Math.max(peak,Math.abs(samples[i]));if(i>0&&(samples[i]>=0)!==(samples[i-1]>=0))crossings++;}
    const properties={durationSeconds:samples.length/48000,sampleRate:48000,rmsDbfs:energy>0?10*Math.log10(energy):null,peakDbfs:peak>0?20*Math.log10(peak):null,zeroCrossingRate:crossings/Math.max(1,samples.length-1)};
    report.push({file:path,start,duration,seconds:samples.length/48000,tags,instrumentCandidates,embedding,properties});
    console.log(JSON.stringify({file:path,start,tags}));
    }
  }
  await mkdir('artifacts/music-evaluation',{recursive:true});
  await writeFile(outputPath,JSON.stringify({catalogVersion:manifest.catalogVersion,categories:DJ_CATALOG.length,scope:songMode ? 'Up to twelve excerpts across each song; not exhaustive coverage.' : 'First ten seconds per file; smoke test, not a labeled accuracy benchmark.',results:report},null,2));
} finally { await model.dispose(); await instruments?.dispose(); await musicModel?.dispose(); }
