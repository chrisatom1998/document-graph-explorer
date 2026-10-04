import { useSettingsStore } from '../store/settingsStore';
import { useGraphStore } from '../store/graphStore';
export default function MusicAnalysisMode({ compact = false }: { compact?: boolean }) {
  const mode = useSettingsStore(s => s.musicAnalysisMode);
  const setMode = useSettingsStore(s => s.setMusicAnalysisMode);
  const phase = useGraphStore(s => s.phase);
  return <div className="music-analysis-mode">
    <label className="settings-field">Music analysis mode
      <select className="settings-input" value={mode} disabled={phase !== 'ready' && phase !== 'idle'} onChange={e => setMode(e.target.value === 'fast' ? 'fast' : 'full')}>
        <option value="full">Full — whole track</option>
        <option value="fast">Quick → Full in background (recommended)</option>
      </select>
    </label>
    {(!compact || mode === 'fast') && <p>{mode === 'fast'
      ? 'See quick estimates first while full analysis finishes in the background.'
      : 'Wait for the whole track to be analyzed before showing results.'}</p>}
  </div>;
}
