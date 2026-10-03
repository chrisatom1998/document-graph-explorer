import {useMusicJobs,cancelAllMusicJobs} from '../store/musicJobs';
import './MusicBackgroundStatus.css';
export default function MusicBackgroundStatus(){
 const count=useMusicJobs(s=>Object.keys(s.jobs).length);
 const minimized=useMusicJobs(s=>s.minimized);
 if(!count||minimized)return null;
 return <aside className="music-background-status" aria-label="Background audio analysis">
  <div role="status">
   <strong>Analyzing {count} audio {count===1?'file':'files'} in the background</strong>
   <p>Short previews across the folder come first, followed by deeper checks and Full scans. Results update automatically as checks finish. You can keep using the graph; keep this app open until analysis finishes.</p>
  </div>
  <div className="music-background-status-actions">
   <button onClick={()=>useMusicJobs.setState({minimized:true})} aria-label="Minimize audio analysis" aria-expanded={true}>Minimize −</button>
   <button onClick={cancelAllMusicJobs}>Stop analysis</button>
  </div>
 </aside>;
}
