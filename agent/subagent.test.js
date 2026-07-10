import { describe, expect, it } from 'vitest';
import { normalizeRepoPath, runAgent } from './subagent.mjs';

describe('standalone subagent', () => {
  it('blocks file paths outside the repository', () => {
    expect(() => normalizeRepoPath('../outside')).toThrow(/escapes repository root/i);
  });

  it('reports dry-run configuration without requiring an API key', async () => {
    const result = await runAgent({
      prompt: 'inspect the repo',
      model: 'test-model',
      baseUrl: 'https://example.invalid/v1',
      maxSteps: 2,
      timeoutMs: 1000,
      dryRun: true,
      trace: false,
    });

    expect(result).toMatchObject({
      model: 'test-model',
      maxSteps: 2,
    });
    expect(result.tools).toEqual([
      'repo_context',
      'list_files',
      'read_file',
      'search_text',
      'inspect_package',
    ]);
  });
});
