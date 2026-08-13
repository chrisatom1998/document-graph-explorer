import { describe, expect, it } from 'vitest';
import { buildDiagnosticsText } from './diagnostics';

describe('buildDiagnosticsText', () => {
  it('formats corpus and environment details without a last error', () => {
    const text = buildDiagnosticsText({
      version: '1.0.0',
      buildFlavor: 'standard',
      userAgent: 'Vitest',
      nodeCount: 3,
      edgeCount: 2,
      lastError: null,
    });

    expect(text).toContain('Version: 1.0.0');
    expect(text).toContain('Build: standard');
    expect(text).toContain('Corpus: 3 nodes, 2 edges');
    expect(text).toContain('Last error: none');
  });

  it('includes a storage line when provided', () => {
    const text = buildDiagnosticsText({
      version: '1.0.0',
      buildFlavor: 'standard',
      userAgent: 'Vitest',
      nodeCount: 1,
      edgeCount: 0,
      lastError: null,
      storage: '12.0 MB of 100.0 MB (12%)',
    });
    expect(text).toContain('Storage: 12.0 MB of 100.0 MB (12%)');
  });

  it('includes last error details when present', () => {
    const text = buildDiagnosticsText({
      version: '1.0.0',
      buildFlavor: 'airgap',
      userAgent: 'Vitest',
      nodeCount: 0,
      edgeCount: 0,
      lastError: {
        message: 'render failed',
        stack: 'stack line',
        at: Date.UTC(2026, 6, 6, 12, 0, 0),
      },
    });

    expect(text).toContain('Last error: render failed');
    expect(text).toContain('Last error at: 2026-07-06T12:00:00.000Z');
    expect(text).toContain('Stack: stack line');
  });
});
