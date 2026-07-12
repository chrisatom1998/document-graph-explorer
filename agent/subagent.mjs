#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
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
const SENSITIVE_FILENAMES = new Set([
  '.npmrc',
  '.pypirc',
  '.netrc',
  'credentials',
  'credentials.json',
  'service-account.json',
]);
const SENSITIVE_EXTENSIONS = new Set(['.key', '.pem', '.p12', '.pfx', '.jks', '.keystore']);
const SENSITIVE_DATA_FILE =
  /^(?:secrets?|credentials?|service[-_.]?account|auth[-_.]?token)(?:\.(?:json|ya?ml|toml|ini|conf|config|txt))?$/;

export function normalizeRepoPath(inputPath = '.') {
  const resolved = resolve(REPO_ROOT, inputPath);
  const rel = relative(REPO_ROOT, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path escapes repository root: ${inputPath}`);
  }
  return resolved;
}

function repoRelativePath(absPath) {
  return relative(REPO_ROOT, absPath).replaceAll('\\', '/') || '.';
}

export function isSensitiveRepoPath(inputPath) {
  const repoPath = isAbsolute(inputPath) ? repoRelativePath(inputPath) : inputPath.replaceAll('\\', '/');
  const segments = repoPath.toLowerCase().split('/').filter(Boolean);
  const fileName = segments.at(-1) ?? '';
  const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
  return (
    segments.includes('.git') ||
    /^\.env(?:\.|$)/.test(fileName) ||
    SENSITIVE_FILENAMES.has(fileName) ||
    SENSITIVE_DATA_FILE.test(fileName) ||
    SENSITIVE_EXTENSIONS.has(extension) ||
    /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/.test(fileName)
  );
}

function normalizeApprovedSensitivePaths(paths = []) {
  return new Set(paths.map((path) => toRepoRelative(normalizeRepoPath(path))));
}

function assertReadablePath(inputPath, approvedSensitivePaths) {
  const requestedPath = normalizeRepoPath(inputPath);
  if (!existsSync(requestedPath)) return requestedPath;

  const realPath = realpathSync(requestedPath);
  const realRelative = relative(REPO_ROOT, realPath);
  if (realRelative.startsWith('..') || isAbsolute(realRelative)) {
    throw new Error(`Path escapes repository root through a symbolic link: ${inputPath}`);
  }

  const requestedRelative = toRepoRelative(requestedPath);
  const canonicalRelative = toRepoRelative(realPath);
  if (
    (isSensitiveRepoPath(requestedRelative) || isSensitiveRepoPath(canonicalRelative)) &&
    !approvedSensitivePaths.has(requestedRelative) &&
    !approvedSensitivePaths.has(canonicalRelative)
  ) {
    throw new Error(
      `Sensitive repository path is blocked: ${requestedRelative}. ` +
        'The operator must explicitly approve this exact path with --allow-sensitive-read.',
    );
  }
  return realPath;
}

function toRepoRelative(absPath) {
  return repoRelativePath(absPath);
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

function walkFiles(startDir, limit, approvedSensitivePaths, files = []) {
  if (files.length >= limit) return files;
  for (const entry of readdirSync(startDir, { withFileTypes: true })) {
    if (files.length >= limit) break;
    const absPath = join(startDir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walkFiles(absPath, limit, approvedSensitivePaths, files);
    } else if (entry.isFile()) {
      const repoPath = toRepoRelative(absPath);
      if (!isSensitiveRepoPath(repoPath) || approvedSensitivePaths.has(repoPath)) files.push(absPath);
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

function listFiles(args, approvedSensitivePaths) {
  const root = assertReadablePath(args.root ?? '.', approvedSensitivePaths);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Directory not found: ${args.root ?? '.'}`);
  }
  const limit = Math.max(1, Math.min(Number(args.limit ?? 200), 1_000));
  return walkFiles(root, limit, approvedSensitivePaths).map(toRepoRelative);
}

export function readFileTool(args, approvedSensitivePaths = new Set()) {
  const absPath = assertReadablePath(args.path, approvedSensitivePaths);
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

function searchText(args, approvedSensitivePaths) {
  const query = String(args.query ?? '').trim();
  if (!query) throw new Error('query is required');
  const root = assertReadablePath(args.root ?? '.', approvedSensitivePaths);
  const limit = Math.max(1, Math.min(Number(args.limit ?? 80), 200));
  const needle = args.caseSensitive ? query : query.toLowerCase();
  const matches = [];

  for (const absPath of walkFiles(root, 5_000, approvedSensitivePaths)) {
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

function createToolHandlers(approvedSensitivePaths) {
  return {
    repo_context: repoContext,
    list_files: (args) => listFiles(args, approvedSensitivePaths),
    read_file: (args) => readFileTool(args, approvedSensitivePaths),
    search_text: (args) => searchText(args, approvedSensitivePaths),
    inspect_package: inspectPackage,
  };
}

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
        'Read a bounded slice of a UTF-8 text file by repo-relative path. Sensitive files are unavailable unless the operator explicitly approved the exact path.',
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
    approvedSensitiveReads: [],
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
    else if (arg === '--allow-sensitive-read') {
      const approvedPath = argv[++index];
      if (!approvedPath) throw new Error('--allow-sensitive-read requires a repo-relative path');
      options.approvedSensitiveReads.push(approvedPath);
    }
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
  npm run agent -- --allow-sensitive-read .env.example "inspect environment setup"
  npm run agent -- --dry-run "show the configured tools"

Environment:
  OPENAI_API_KEY   Required unless --dry-run is used.
  OPENAI_MODEL     Optional. Defaults to gpt-5-mini.
  OPENAI_BASE_URL  Optional OpenAI-compatible /v1 endpoint.

Sensitive files (.git metadata, environment files, credentials, and private keys)
are blocked by default. Repeat --allow-sensitive-read with an exact repo-relative
path to approve an exceptional read for this run.
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
  const approvedSensitivePaths = normalizeApprovedSensitivePaths(options.approvedSensitiveReads);
  const toolHandlers = createToolHandlers(approvedSensitivePaths);
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
        'You are a standalone Knowledge Nebula subagent. Work from repository evidence, use tools before making repo claims, keep actions read-only, surface uncertainty, and stop when the answer is complete. Never claim to edit files. Sensitive repository files are blocked unless the operator explicitly approved an exact path for this run.',
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
