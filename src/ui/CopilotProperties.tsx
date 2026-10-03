import type { MusicAnalysis } from '../audio/musicTypes';

export default function CopilotProperties({ audio }: { audio: MusicAnalysis }) {
  const properties = audio.copilotProperties;
  if (!properties) return null;
  return <div className="dj-suggested-properties">
    <strong>AI-suggested properties · not confirmed</strong>
    <p>{Object.entries(properties.tags).filter(([, labels]) => labels.length).map(([group, labels]) => `${group}: ${labels.join(', ')}`).join(' · ')}</p>
    <p className="dj-note">Suggested by {properties.model} from metadata, not a listening assessment. {audio.confirmedDjTags !== undefined ? 'Your confirmed labels take priority; these suggestions are not used in search.' : 'Available in sample search. Your confirmed instruments take priority.'}</p>
  </div>;
}
