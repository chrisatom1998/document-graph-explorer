import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isSensitiveRepoPath,
  normalizeRepoPath,
  readFileTool,
  runAgent,
} from './subagent.mjs';

describe('standalone subagent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('blocks file paths outside the repository', () => {
    expect(() => normalizeRepoPath('../outside')).toThrow(/escapes repository root/i);
  });

  it('blocks sensitive repository files unless the operator approves the exact path', () => {
    expect(isSensitiveRepoPath('.env.production')).toBe(true);
    expect(isSensitiveRepoPath('certs/private.pem')).toBe(true);
    expect(isSensitiveRepoPath('config/secrets.yaml')).toBe(true);
    expect(isSensitiveRepoPath('src/config.ts')).toBe(false);

    expect(() => readFileTool({ path: '.git/config' })).toThrow(/sensitive repository path is blocked/i);

    const approved = readFileTool({ path: '.git/config' }, new Set(['.git/config']));
    expect(approved.path).toBe('.git/config');
    expect(approved.content.length).toBeGreaterThan(0);
  });

  it('continues to allow ordinary repository reads', () => {
    expect(readFileTool({ path: 'package.json', maxLines: 1 })).toMatchObject({
      path: 'package.json',
      startLine: 1,
      endLine: 1,
    });
  });

  it('does not send a model-requested sensitive file back to the provider', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new globalThis.Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'read-sensitive',
                      type: 'function',
                      function: { name: 'read_file', arguments: '{"path":".git/config"}' },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new globalThis.Response(
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Blocked.' } }] }),
          { status: 200 },
        ),
      );

    await expect(
      runAgent({
        prompt: 'Read the git config',
        model: 'test-model',
        baseUrl: 'https://example.invalid/v1',
        maxSteps: 2,
        timeoutMs: 1000,
        dryRun: false,
        trace: false,
      }),
    ).resolves.toBe('Blocked.');

    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const toolResult = secondRequest.messages.find((message) => message.role === 'tool');
    expect(JSON.parse(toolResult?.content ?? '{}')).toMatchObject({
      error: expect.stringMatching(/sensitive repository path is blocked/i),
    });
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
