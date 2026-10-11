import { DASHENG_POLICY } from '../audio/dashengAddon';
import { dashengDeviceReason } from '../store/dashengAddonSetting';
import { useSettingsStore } from '../store/settingsStore';

/** Opt-in for the desktop Dasheng add-on (src/audio/dashengAddon.ts). Off by default; nothing downloads until it is on. */
export default function DashengAddonToggle() {
  const on = useSettingsStore(s => s.dashengAddon);
  const offline = useSettingsStore(s => s.offlineMode);
  const setOn = useSettingsStore(s => s.setDashengAddon);
  const reason = dashengDeviceReason();
  const tags = DASHENG_POLICY.tags.map(t => t.label).join(', ');
  return <div className="dasheng-addon">
    <label className="settings-check" title={reason ?? undefined}>
      <input type="checkbox" checked={on && !reason} disabled={!!reason} onChange={e => setOn(e.target.checked)} />
      Desktop percussion add-on (larger listening model)
    </label>
    <p className="settings-help">
      {reason
        ? reason
        : <>Downloads a {DASHENG_POLICY.downloadMB} MB model once from huggingface.co and uses it for {tags}. Applies to
          tracks analyzed from now on, and to saved tracks the next time they load. Turn it off to go back to the standard tags.
          {on && offline ? ' Offline mode is on, so new tracks skip it until you turn offline mode off.' : ''}</>}
    </p>
  </div>;
}
