import { AIRGAP } from '../airgap';
import { dashengBlockedReason, setDashengDisplayEnabled } from '../audio/dashengAddon';
import { isTouchMac } from '../audio/gpuModelPolicy';
import { useSettingsStore, type SettingsState } from './settingsStore';

/** Why this build or device cannot use the desktop Dasheng add-on (src/audio/dashengAddon.ts), or null. */
export function dashengDeviceReason(): string | null {
  if (AIRGAP) return 'Not available in the air-gapped build (it downloads from huggingface.co)';
  if (typeof navigator === 'undefined') return 'Unavailable here';
  return dashengBlockedReason({ deviceMemory: (navigator as { deviceMemory?: number }).deviceMemory,
    connection: (navigator as { connection?: { saveData?: boolean } }).connection,
    userAgentData: (navigator as { userAgentData?: { mobile?: boolean } }).userAgentData, userAgent: navigator.userAgent, touchTablet: isTouchMac() });
}
/** New analyses run the add-on: turned on, on an eligible device, and not in offline mode (which forbids the download). */
export const dashengAnalysisActive = (s: Pick<SettingsState, 'dashengAddon' | 'offlineMode'> = useSettingsStore.getState()) =>
  s.dashengAddon && !s.offlineMode && !dashengDeviceReason();
/** Saved add-on scores show while it is turned on (offline mode only stops new downloads). */
const displayActive = (s: Pick<SettingsState, 'dashengAddon'>) => s.dashengAddon && !dashengDeviceReason();

setDashengDisplayEnabled(displayActive(useSettingsStore.getState()));
useSettingsStore.subscribe(s => setDashengDisplayEnabled(displayActive(s)));
