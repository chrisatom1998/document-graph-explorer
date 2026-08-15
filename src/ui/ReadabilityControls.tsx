import { useUiStore } from '../store/uiStore';
import {
  READABILITY_PRESETS,
  edgeDensityFromWeight,
  matchingPreset,
  weightFromEdgeDensity,
  type ReadabilityPresetId,
} from './graphReadability';

export default function ReadabilityControls() {
  const minEdgeWeight = useUiStore((s) => s.filter.minEdgeWeight);
  const labelDensity = useUiStore((s) => s.labelDensity);
  const clusterAtmosphere = useUiStore((s) => s.clusterAtmosphere);
  const setFilter = useUiStore((s) => s.setFilter);
  const setLabelDensity = useUiStore((s) => s.setLabelDensity);
  const setClusterAtmosphere = useUiStore((s) => s.setClusterAtmosphere);

  const activePreset = matchingPreset(minEdgeWeight, labelDensity, clusterAtmosphere);
  const edgeDensity = edgeDensityFromWeight(minEdgeWeight);

  const applyPreset = (id: ReadabilityPresetId) => {
    const preset = READABILITY_PRESETS[id];
    setFilter({ minEdgeWeight: preset.minEdgeWeight });
    setLabelDensity(preset.labelDensity);
    setClusterAtmosphere(preset.clusterAtmosphere);
  };

  return (
    <div className="readability-strip glass-panel" aria-label="Graph readability controls">
        <div className="readability-strip__presets">
          {(Object.values(READABILITY_PRESETS) as typeof READABILITY_PRESETS[ReadabilityPresetId][]).map(
            (preset) => (
              <button
                key={preset.id}
                type="button"
                className={`readability-strip__preset${activePreset === preset.id ? ' is-active' : ''}`}
                aria-pressed={activePreset === preset.id}
                title={`${preset.label} density preset`}
                onClick={() => applyPreset(preset.id)}
              >
                {preset.label}
              </button>
            ),
          )}
        </div>
        <label className="readability-strip__control">
          <span>Edges</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={edgeDensity}
            aria-label="Edge density"
            title="Show more or fewer connections"
            onChange={(e) => setFilter({ minEdgeWeight: weightFromEdgeDensity(Number(e.target.value)) })}
          />
        </label>
        <label className="readability-strip__control">
          <span>Labels</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={labelDensity}
            aria-label="Label density"
            title="How many document titles stay on screen"
            onChange={(e) => setLabelDensity(Number(e.target.value))}
          />
        </label>
        <label className="readability-strip__control">
          <span>Hulls</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={clusterAtmosphere}
            aria-label="Cluster hull opacity"
            title="Strength of cluster atmosphere"
            onChange={(e) => setClusterAtmosphere(Number(e.target.value))}
          />
        </label>
    </div>
  );
}
