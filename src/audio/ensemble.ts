import { applyDjClassification } from './djClassification';
import { isBroadInstrument } from './instrumentLabels';
import { jamendoSuggestions } from './jamendo';
import { selectDescriptions, type DescriptionScore } from './profileDescriptions';
import type { InstrumentEstimate } from './musicTypes';
import type { SoundProfile } from './soundProfile';

/** Evidence fusion, not an average of incompatible model score scales.
 * Instrument-trained models identify the source; CLAP describes resemblance/role. */
export function combineSoundModels(ast: InstrumentEstimate[], jamendo: Record<string, number>, descriptions: DescriptionScore[], complete: { ast: boolean; jamendo: boolean; clap: boolean }): SoundProfile {
  const likely = ast.filter(i => i.status === 'likely' && !isBroadInstrument(i.label)).sort((a,b) => b.score-a.score);
  const music = jamendoSuggestions(jamendo);
  const clap = selectDescriptions(descriptions);
  // A substantial AST candidate can beat a conflicting music tag when a
  // second model clearly agrees. This remains an estimate, never a graph vote.
  const supported = clap.sourceClear && clap.sources[0]?.score >= .35
    ? ast.find(i => !isBroadInstrument(i.label) && i.score >= .55 && i.label === clap.sources[0].label)
    : undefined;
  const instrument = likely[0] ?? supported;
  const profile: SoundProfile = {
    version: 1, character: clap.character, roles: clap.roles,
    disagreement: !!(instrument && music[0] && instrument.label !== music[0].label),
    models: [
      { model: 'AudioSet AST', complete: complete.ast, candidates: ast.slice(0,5).map(i => ({ label: i.label, score: i.score })) },
      { model: 'MTG-Jamendo', complete: complete.jamendo, candidates: music.map(i => ({ label: i.label, score: i.score })) },
      { model: 'Music CLAP', complete: complete.clap, candidates: clap.sources },
    ],
  };
  const primary = instrument ?? music[0];
  if (primary) {
    profile.source = { label: primary.label, basis: instrument ? 'AudioSet AST' : 'MTG-Jamendo', corroborated: !!(instrument && music[0]?.label === primary.label) || (clap.sourceClear && clap.sources[0]?.label === primary.label) };
  } else if (['voice', 'environmental sound', 'noise'].includes(clap.sources[0]?.label)) {
    // Non-instrument sources need a clear CLAP lead, not a forced musical label.
    const top = clap.sources[0];
    const competitors = descriptions.filter(d => d.group === 'source' && d.label !== top.label);
    if (top.score >= .35 && top.score - Math.max(0, ...competitors.map(d => d.score)) >= .05) profile.source = { label: top.label, basis: 'Music CLAP', corroborated: false };
  }
  // Voice is a co-occurring source: do not lose it just because an instrument wins.
  const astVoice = ast.find(i => i.label === 'voice');
  const musicVoice = music.find(i => i.label === 'voice');
  const clapVoice = clap.sourceClear && clap.sources[0]?.label === 'voice' && clap.sources[0].score >= .35;
  if (astVoice?.status === 'likely' || (astVoice && astVoice.score >= .55 && clapVoice)) {
    profile.voice = { basis: 'AudioSet AST', corroborated: !!musicVoice || clapVoice };
  } else if (musicVoice) {
    profile.voice = { basis: 'MTG-Jamendo', corroborated: clapVoice };
  } else if (clap.vocalSource) {
    profile.voice = { basis: 'Music CLAP', corroborated: false };
  } else if (profile.source?.label === 'voice') {
    profile.voice = { basis: profile.source.basis, corroborated: profile.source.corroborated };
  }
  if (!profile.source && profile.voice) profile.source = { label: 'voice', basis: profile.voice.basis, corroborated: profile.voice.corroborated };
  if (profile.source?.label === 'voice' && profile.voice) profile.source.corroborated = profile.voice.corroborated;
  if (profile.voice && clap.vocalStyle) profile.voice.style = clap.vocalStyle;
  // A confident vocal chop can resemble many instruments. A second source
  // needs strong AST evidence or independent agreement, not one tagger's score.
  // Keep rejected guesses in model comparisons instead of presenting a mixture.
  const supportedMusic = music.find(candidate => ast.some(i =>
    i.label === candidate.label && i.score >= .55 && candidate.score >= .5));
  if (profile.voice?.style === 'vocal chops' && clap.vocalSource && !instrument && profile.source?.label !== 'voice') {
    if (supportedMusic) {
      profile.source = { label: supportedMusic.label, basis: 'MTG-Jamendo', corroborated: true };
    } else if (!profile.source?.corroborated) {
      profile.disagreement = !!profile.source;
      profile.source = { label: 'voice', basis: profile.voice.basis, corroborated: profile.voice.corroborated };
    }
  }
  if (clap.sources[0] && clap.sources[0].label !== profile.source?.label) profile.resemblance = clap.sources[0].label;
  return applyDjClassification(profile, ast, descriptions);
}
