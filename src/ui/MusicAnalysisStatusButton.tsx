import {useMusicJobs} from '../store/musicJobs';
import './MusicBackgroundStatus.css';

/** Lives in the toolbar layout instead of covering another floating control. */
export default function MusicAnalysisStatusButton(){
 const count=useMusicJobs(s=>Object.keys(s.jobs).length);
 const minimized=useMusicJobs(s=>s.minimized);
 if(!count||!minimized)return null;
 return <button type="button" className="btn-icon music-analysis-status-button"
  title={`Analyzing ${count} audio ${count===1?'file':'files'} — show details`}
  aria-label="Show audio analysis details" aria-expanded={false}
  onClick={()=>useMusicJobs.setState({minimized:false})}>
  <span aria-hidden="true">♫</span>
  <span role="status" aria-label={`${count} audio files analyzing`}>{count>99?'99+':count}</span>
 </button>;
}
