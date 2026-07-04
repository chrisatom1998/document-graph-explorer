/**
 * True only in builds produced by `npm run build:airgap` (Vite `--mode airgap`).
 * Gates every AI/network surface. Kept a one-line constant on purpose — tests
 * reach the guarded paths via `vi.mock('../airgap', …)`, never by mutating this.
 */
export const AIRGAP = import.meta.env.MODE === 'airgap';

/** User-facing copy shown wherever an AI path is refused in an airgap build. */
export const AIRGAP_MESSAGE =
  'This is an air-gapped build — AI features are disabled (no external network).';
