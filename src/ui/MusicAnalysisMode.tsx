import { useSettingsStore } from '../store/settingsStore';
import { useGraphStore } from '../store/graphStore';
export default function MusicAnalysisMode({ compact = false }: { compact?: boolean }) {
  const mode = useSettingsStore(s => s.musicAnalysisMode);
  const setMode = useSettingsStore(s => s.setMusicAnalysisMode);
  const phase = useGraphStore(s => s.phase);
  return <div className="music-analysis-mode">
    <label className="settings-field">Music analysis mode
      <select className="settings-input" value={mode} disabled={phase !== 'ready' && phase !== 'idle'} onChange={e => setMode(e.target.value === 'fast' ? 'fast' : 'full')}>
        <option value="full">Full — whole track (recommended)</option>
        <option value="fast">Fast — selected sections</option>
      </select>
    </label>
    {compact ? (mode === 'fast' && <p>Samples sections; may miss brief sounds.</p>) : <p>Full checks the whole track. Fast samples sections and may miss brief sounds. Each mode shows an early estimate. Applies to new uploads and reanalysis.</p>}
  </div>;
}
