import {jamendoLabels} from '../jamendo';
import {selectDescriptions} from '../profileDescriptions';
import {LABELS,type Label,type RawScores} from './adapter';
/** Same per-window binary baseline as the reviewed browser feature assembler. */
export function deriveBaseline(raw:RawScores,aliases:Record<Label,string[]>):Label[]{
  const selected=selectDescriptions(raw.clap.descriptions as Parameters<typeof selectDescriptions>[0]);
  const nativeNames=[...Object.entries(raw.ast.instruments).filter(([,score])=>score>=.35).map(([name])=>name),
    ...jamendoLabels(raw.jamendo).filter(s=>s.dimension==='source').map(s=>s.labelId),
    ...selected.sources.map(s=>s.label),...(selected.vocalSourceEvidence?['voice']:[])];
  return LABELS.filter(label=>aliases[label].some(name=>nativeNames.includes(name)));
}
