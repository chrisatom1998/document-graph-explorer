import { create } from 'zustand';

export type SampleAssistantTab = 'library' | 'packs' | 'copilot' | 'overview';
interface SampleAssistantState {
  request: number;
  tab: SampleAssistantTab;
  selectedIds: string[];
  question: string;
}
export const useSampleAssistantStore = create<SampleAssistantState>(() => ({ request: 0, tab: 'library', selectedIds: [], question: '' }));
export function openSampleAssistant(tab: SampleAssistantTab = 'library', selectedIds: string[] = [], question = '') {
  useSampleAssistantStore.setState(s => ({ request: s.request + 1, tab, selectedIds: selectedIds.slice(0, 5), question }));
}
