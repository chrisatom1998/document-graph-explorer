import { useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { layoutSetDims } from '../layout/layoutBridge';

const DISMISS_KEY = 'kn:qualityToastDismissed';

/**
 * Small bottom-left toast suggesting 2D mode when the auto-quality ladder
 * bottoms out (qualityTier === 4). Exported standalone but — because
 * App.tsx is frozen and does not mount it directly — actually rendered
 * from within ProgressStrip's returned fragment (see ProgressStrip.tsx).
 */
export default function QualityToast() {
  const qualityTier = useUiStore((s) => s.qualityTier);
  const setDims = useUiStore((s) => s.setDims);

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (qualityTier !== 4 || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* sessionStorage unavailable (private mode etc.) — dismissal just won't persist */
    }
  };

  const switchTo2D = () => {
    setDims(2);
    layoutSetDims(2);
    dismiss();
  };

  return (
    <div className="quality-toast glass-panel">
      <p className="quality-toast__text">Struggling to keep up — try 2D mode?</p>
      <div className="quality-toast__actions">
        <button type="button" className="btn-pill secondary" onClick={switchTo2D}>
          Switch to 2D
        </button>
        <button
          type="button"
          className="icon-btn-close"
          title="Dismiss"
          onClick={dismiss}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
