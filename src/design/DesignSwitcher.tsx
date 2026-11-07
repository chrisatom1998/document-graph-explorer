import { useRef, useState, type KeyboardEvent } from 'react';
import { DESIGN_CHOICES, DESIGN_INFO, selectDesign, type DesignChoice } from './designMode';
import './design-switcher.css';

/** Floating picker for the design explorations; DesignLayer mounts it only when `?design=` is present. */
export default function DesignSwitcher({ initial }: { initial: DesignChoice }) {
  const [choice, setChoice] = useState<DesignChoice>(initial);
  const [collapsed, setCollapsed] = useState(false);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const pick = (next: DesignChoice) => {
    setChoice(next);
    selectDesign(next);
  };

  // Radio-group keyboard model: arrows move and select, focus follows.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = (DESIGN_CHOICES.indexOf(choice) + step + DESIGN_CHOICES.length) % DESIGN_CHOICES.length;
    pick(DESIGN_CHOICES[index]);
    buttons.current[index]?.focus();
  };

  if (collapsed) {
    return (
      <button type="button" className="design-switcher design-switcher--collapsed" aria-label={`Show design picker (${DESIGN_INFO[choice].name})`} onClick={() => setCollapsed(false)}>
        Design · {DESIGN_INFO[choice].label}
      </button>
    );
  }

  return (
    <div className="design-switcher">
      <span className="design-switcher__label" id="design-switcher-label">Design</span>
      <div className="design-switcher__options" role="radiogroup" aria-labelledby="design-switcher-label" onKeyDown={onKeyDown}>
        {DESIGN_CHOICES.map((option, i) => (
          <button
            key={option}
            ref={el => { buttons.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={choice === option}
            tabIndex={choice === option ? 0 : -1}
            title={DESIGN_INFO[option].name}
            onClick={() => pick(option)}
          >
            {DESIGN_INFO[option].label}
          </button>
        ))}
      </div>
      <span className="design-switcher__name" aria-live="polite">{DESIGN_INFO[choice].name}</span>
      <button type="button" className="design-switcher__hide" aria-label="Hide design picker" onClick={() => setCollapsed(true)}>×</button>
    </div>
  );
}
