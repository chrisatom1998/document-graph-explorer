#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_TOOL_RESULT_CHARS = 24_000;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-airgap',
  'release',
  'coverage',
  'copilot-worktrees',
]);

export function normalizeRepoPath(inputPath = '.') {
  const resolved = resolve(REPO_ROOT, inputPath);
  const rel = relative(REPO_ROOT, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path escapes repository root: ${inputPath}`);
  }
  return resolved;
}

function toRepoRelative(absPath) {
  return relative(REPO_ROOT, absPath).replaceAll('\\', '/') || '.';
}

function parseJsonArgs(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Tool arguments must be JSON: ${error.message}`);
  }
}

function truncate(value, maxChars = DEFAULT_TOOL_RESULT_CHARS) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

function walkFiles(startDir, limit, files = []) {
  if (files.length >= limit) return files;
  for (const entry of readdirSync(startDir, { withFileTypes: true })) {
    if (files.length >= limit) break;
    const absPath = join(startDir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walkFiles(absPath, limit, files);
    } else if (entry.isFile()) {
      files.push(absPath);
    }
  }
  return files;
}

function readTextFile(absPath, maxBytes = 512_000) {
  const size = statSync(absPath).size;
  if (size > maxBytes) {
    throw new Error(`File is too large to read safely (${size} bytes): ${toRepoRelative(absPath)}`);
  }
  return readFileSync(absPath, 'utf8');
}

function listFiles(args) {
  const root = normalizeRepoPath(args.root ?? '.');
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Directory not found: ${args.root ?? '.'}`);
  }
  const limit = Math.max(1, Math.min(Number(args.limit ?? 200), 1_000));
  return walkFiles(root, limit).map(toRepoRelative);
}

function readFileTool(args) {
  const absPath = normalizeRepoPath(args.path);
  if (!existsSync(absPath) || !statSync(absPath).isFile()) {
    throw new Error(`File not found: ${args.path}`);
  }
  const startLine = Math.max(1, Number(args.startLine ?? 1));
  const maxLines = Math.max(1, Math.min(Number(args.maxLines ?? 160), 400));
  const lines = readTextFile(absPath).split(/\r?\n/);
  return {
    path: toRepoRelative(absPath),
    startLine,
    endLine: Math.min(lines.length, startLine + maxLines - 1),
    content: lines.slice(startLine - 1, startLine - 1 + maxLines).join('\n'),
  };
}

function searchText(args) {
  const query = String(args.query ?? '').trim();
  if (!query) throw new Error('query is required');
  const root = normalizeRepoPath(args.root ?? '.');
  const limit = Math.max(1, Math.min(Number(args.limit ?? 80), 200));
  const needle = args.caseSensitive ? query : query.toLowerCase();
  const matches = [];

  for (const absPath of walkFiles(root, 5_000)) {
    if (matches.length >= limit) break;
    let content;
    try {
      content = readTextFile(absPath, 256_000);
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
      const haystack = args.caseSensitive ? lines[index] : lines[index].toLowerCase();
      if (haystack.includes(needle)) {
        matches.push({
          path: toRepoRelative(absPath),
          line: index + 1,
          text: lines[index].trim().slice(0, 500),
        });
      }
    }
  }

  return matches;
}

function inspectPackage(args) {
  const pkg = JSON.parse(readTextFile(join(REPO_ROOT, 'package.json')));
  if (args.script) {
    const command = pkg.scripts?.[args.script];
    if (!command) throw new Error(`Unknown npm script: ${args.script}`);
    return { script: args.script, command };
  }
  return { name: pkg.name, version: pkg.version, scripts: pkg.scripts };
}

function repoContext() {
  const status = spawnSync('git', ['status', '--short'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: false,
  });
  return {
    repoRoot: REPO_ROOT,
    package: inspectPackage({}),
    hasReadme: existsSync(join(REPO_ROOT, 'README.md')),
    hasSecurityDoc: existsSync(join(REPO_ROOT, 'SECURITY.md')),
    gitStatusShort: status.status === 0 ? status.stdout.trim() : `git status failed: ${status.stderr.trim()}`,
    privacyNote:
      'This repo is a local-first browser app. Keep standalone agent code outside the Vite app bundle and do not change airgap behavior unless explicitly requested.',
  };
}

const toolHandlers = {
  repo_context: repoContext,
  list_files: listFiles,
  read_file: readFileTool,
  search_text: searchText,
  inspect_package: inspectPackage,
};

const tools = [
  {
    type: 'function',
    function: {
      name: 'repo_context',
      description:
        'Summarize repository location, package scripts, git status, and privacy guardrails. Use first for repo-grounded tasks.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        'List repository files under a directory. Use to discover code and docs. Ignores build output, node_modules, and git data.',
      parameters: {
        type: 'object',
        properties: {
          root: { type: 'string', description: 'Repo-relative directory to list. Defaults to repository root.' },
          limit: { type: 'number', description: 'Maximum files to return, capped at 1000.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read a bounded slice of a UTF-8 text file by repo-relative path. Use after list_files or search_text identifies a target.',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Repo-relative file path.' },
          startLine: { type: 'number', description: '1-based starting line. Defaults to 1.' },
          maxLines: { type: 'number', description: 'Maximum lines to return, capped at 400.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_text',
      description:
        'Search text files for a literal query. Use for finding existing patterns, docs, and code references.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Literal text to search for.' },
          root: { type: 'string', description: 'Repo-relative directory to search. Defaults to repository root.' },
          caseSensitive: { type: 'boolean', description: 'Whether matching is case-sensitive. Defaults to false.' },
          limit: { type: 'number', description: 'Maximum matches to return, capped at 200.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_package',
      description:
        'Inspect package metadata or one npm script. Use before recommending commands or verification steps.',
      parameters: {
        type: 'object',
        properties: {
          script: { type: 'string', description: 'Optional npm script name to inspect.' },
        },
        additionalProperties: false,
      },
    },
  },
];

function parseCli(argv) {
  const options = {
    prompt: '',
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    maxSteps: DEFAULT_MAX_STEPS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
    trace: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--prompt') options.prompt = argv[++index] ?? '';
    else if (arg === '--model') options.model = argv[++index] ?? options.model;
    else if (arg === '--base-url') options.baseUrl = argv[++index] ?? options.baseUrl;
    else if (arg === '--max-steps') options.maxSteps = Number(argv[++index] ?? options.maxSteps);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index] ?? options.timeoutMs);
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-trace') options.trace = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else options.prompt = `${options.prompt} ${arg}`.trim();
  }

  return options;
}

function usage() {
  return `Knowledge Nebula standalone subagent

Usage:
  npm run agent -- "answer a repo question"
  npm run agent -- --prompt "inspect the chat code" --model gpt-5-mini
  npm run agent -- --dry-run "show the configured tools"

Environment:
  OPENAI_API_KEY   Required unless --dry-run is used.
  OPENAI_MODEL     Optional. Defaults to gpt-5-mini.
  OPENAI_BASE_URL  Optional OpenAI-compatible /v1 endpoint.
`;
}

function createTraceWriter(enabled) {
  if (!enabled) return () => {};
  const runsDir = join(REPO_ROOT, 'agent', 'runs');
  mkdirSync(runsDir, { recursive: true });
  const file = join(runsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  return (event) => {
    writeFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`, { flag: 'a' });
  };
}

async function callModel({ baseUrl, apiKey, model, messages, timeoutMs }) {
  const controller = new globalThis.AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
      }),
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Model request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Model returned non-JSON response (${response.status}): ${text.slice(0, 500)}`);
  }

  if (!response.ok) {
    const message = payload.error?.message ?? JSON.stringify(payload).slice(0, 500);
    throw new Error(`Model request failed (${response.status}): ${message}`);
  }

  return payload.choices?.[0]?.message;
}

export async function runAgent(options) {
  if (options.dryRun) {
    return {
      model: options.model,
      maxSteps: options.maxSteps,
      tools: tools.map((tool) => tool.function.name),
      repoRoot: REPO_ROOT,
    };
  }

  if (!options.prompt.trim()) throw new Error('A prompt is required.');
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required. Set it in your environment first.');

  const startedAt = Date.now();
  const trace = createTraceWriter(options.trace);
  const messages = [
    {
      role: 'system',
      content:
        'You are a standalone Knowledge Nebula subagent. Work from repository evidence, use tools before making repo claims, keep actions read-only, surface uncertainty, and stop when the answer is complete. Never claim to edit files.',
    },
    { role: 'user', content: options.prompt },
  ];

  for (let step = 1; step <= options.maxSteps; step += 1) {
    if (Date.now() - startedAt > options.timeoutMs) {
      throw new Error(`Agent timed out after ${options.timeoutMs}ms`);
    }

    trace({ type: 'model_request', step, messageCount: messages.length });
    const message = await callModel({
      baseUrl: options.baseUrl,
      apiKey: process.env.OPENAI_API_KEY,
      model: options.model,
      messages,
      timeoutMs: Math.max(1, options.timeoutMs - (Date.now() - startedAt)),
    });
    if (!message) throw new Error('Model response did not include a message.');
    messages.push(message);

    if (!message.tool_calls?.length) {
      trace({ type: 'final', step, content: message.content ?? '' });
      return message.content ?? '';
    }

    for (const toolCall of message.tool_calls) {
      const name = toolCall.function?.name;
      const handler = toolHandlers[name];
      if (!handler) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: `Unknown tool: ${name}` }),
        });
        continue;
      }

      try {
        const args = parseJsonArgs(toolCall.function?.arguments);
        const result = handler(args);
        trace({ type: 'tool_result', step, tool: name, args, ok: true });
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: truncate(result) });
      } catch (error) {
        trace({ type: 'tool_result', step, tool: name, ok: false, error: error.message });
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: error.message }),
        });
      }
    }
  }

  throw new Error(`Agent reached max steps (${options.maxSteps}) before producing a final answer.`);
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = await runAgent(options);
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
