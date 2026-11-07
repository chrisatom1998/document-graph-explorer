import { lazy, Suspense } from 'react';
import DesignSwitcher from './DesignSwitcher';
import NowPlayingAudio from './music/NowPlayingAudio';
import { useDesignStore, type DesignChoice } from './designMode';
import './music/music-base.css';

const NightShell = lazy(() => import('./night/NightShell'));
const AuraShell = lazy(() => import('./aura/AuraShell'));
const ForYouShell = lazy(() => import('./foryou/ForYouShell'));

/** Everything behind `?design=`: the picker, the active music design and its shared audio element. */
export default function DesignLayer({ initial }: { initial: DesignChoice }) {
  const design = useDesignStore(s => s.design);
  return (
    <>
      {design && <NowPlayingAudio />}
      <Suspense fallback={null}>
        {design === 'a' && <NightShell />}
        {design === 'b' && <AuraShell />}
        {design === 'c' && <ForYouShell />}
      </Suspense>
      <DesignSwitcher initial={initial} />
    </>
  );
}
