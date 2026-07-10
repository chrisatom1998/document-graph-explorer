# Standalone Subagent

This is a small read-only agent runner for repo-aware Knowledge Nebula tasks. It is intentionally outside `src/` so it is not bundled into the browser app and does not change the sealed `build:airgap` path.

## Run

```bash
npm run agent -- "inspect the chat system and explain how it answers questions"
```

Set an OpenAI-compatible model endpoint with environment variables:

```powershell
$env:OPENAI_API_KEY = "..."
$env:OPENAI_MODEL = "gpt-5-mini"
```

Optional:

```powershell
$env:OPENAI_BASE_URL = "https://api.openai.com/v1"
```

Use `--dry-run` to verify configuration without a network call:

```bash
npm run agent -- --dry-run "show tools"
```

## Guardrails

- Read-only repo tools only.
- Repository path validation blocks `..` escapes.
- Default max loop length is 8 model turns.
- Default wall-clock timeout is 120 seconds.
- Tool results are capped before being returned to the model.
- JSONL traces are written under `agent/runs/` unless `--no-trace` is passed.

## Tools

- `repo_context`: summarize repo root, package scripts, git status, and privacy notes.
- `list_files`: discover files under a repo-relative directory.
- `read_file`: read a bounded slice of a text file.
- `search_text`: literal search through text files.
- `inspect_package`: inspect package metadata or a single npm script.
