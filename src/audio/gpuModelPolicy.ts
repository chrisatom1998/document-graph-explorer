/**
 * Whether this device should download the 347 MB full-precision AST for the
 * graphics card. Phones and data-saver connections keep the 78 MB q8 model on
 * the processor (every AudioSet score within 0.023, same top five), which
 * roughly halves the first analysis download. Desktop browsers and the
 * desktop app keep the faster graphics-card model.
 */
export interface GpuModelNavigator {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
  userAgentData?: { mobile?: boolean };
  userAgent?: string;
}

const MOBILE_UA = /Android|iPhone|iPod|Mobile/i;

export function gpuModelBlockedReason(nav: GpuModelNavigator): string | null {
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return 'Too little memory for a second AST model';
  if (nav.connection?.saveData === true) return 'Data saver is on';
  if (nav.userAgentData?.mobile === true || MOBILE_UA.test(nav.userAgent ?? '')) return 'Phone or tablet: skipping the large graphics-card model';
  return null;
}
