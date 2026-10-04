import { create } from 'zustand';
import type { CopilotSample } from '../audio/copilotEvidence';

export interface UploadReport { ids: string[]; evidence: CopilotSample[]; answer: string; model: string }
interface UploadInsightsState { enabled: boolean; busy: boolean; error: string; reports: UploadReport[]; revision: number }
function enabled() { try { return localStorage.getItem('dge:auto-upload-summaries') === 'true'; } catch { return false; } }
export const useUploadInsightsStore = create<UploadInsightsState>(() => ({ enabled: enabled(), busy: false, error: '', reports: [], revision: 0 }));
export function setAutomaticSummaries(value: boolean) {
  useUploadInsightsStore.setState({ enabled: value, error: '' });
  try { localStorage.setItem('dge:auto-upload-summaries', String(value)); } catch { /* The preference still works for this tab. */ }
}
