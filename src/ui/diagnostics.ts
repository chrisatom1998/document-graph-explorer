import type { LastError } from '../store/uiStore';

export interface DiagnosticsInput {
  version: string;
  buildFlavor: string;
  userAgent: string;
  nodeCount: number;
  edgeCount: number;
  lastError: LastError | null;
}

export function getAppVersion(): string {
  return typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__ ? __APP_VERSION__ : 'dev';
}

export function buildDiagnosticsText(input: DiagnosticsInput): string {
  const lines = [
    'Document Graph Explorer diagnostics',
    `Version: ${input.version}`,
    `Build: ${input.buildFlavor}`,
    `User agent: ${input.userAgent}`,
    `Corpus: ${input.nodeCount} nodes, ${input.edgeCount} edges`,
  ];

  if (input.lastError) {
    lines.push(`Last error: ${input.lastError.message}`);
    lines.push(`Last error at: ${new Date(input.lastError.at).toISOString()}`);
    if (input.lastError.stack) lines.push(`Stack: ${input.lastError.stack}`);
  } else {
    lines.push('Last error: none');
  }

  return lines.join('\n');
}
