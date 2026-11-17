import type { ReactNode } from 'react';
import NightShell from '../../design/night/NightShell';

/** Workspace chrome. Night Session lays out the library, sound map and player around the graph. */
export default function ResonanceShell({ children }: { children: ReactNode }) {
  return <NightShell graph={children} />;
}
