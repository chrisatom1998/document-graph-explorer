# Repository Hygiene Cleanup — Design

**Date:** 2026-08-15  
**Status:** Approved for implementation  
**Scope:** Tracked local-development artifacts, ignore rules, Docker context, and repository metadata

## Goal

Remove ephemeral tool output from the current repository tree, prevent it from being committed or sent into Docker builds again, and make the public repository easier to discover without changing application behavior or the offline distribution contract.

## Current findings

- The repository tracks 27 files under `.playwright-mcp/`, including console logs and page-state snapshots.
- The repository root tracks `.codex-devserver.log` and `.codex-devserver.err.log`.
- `.gitignore` does not exclude those paths, Playwright reports, test results, or trace archives.
- `.dockerignore` also permits these local tool artifacts into the Docker build context.
- The public repository has no concise product description or discovery topics.
- The bundled FP16 and quantized ONNX models are intentionally part of the offline runtime and are not safe to relocate in this cleanup.

## Approaches considered

### A. Safe current-tree cleanup — selected

Delete the tracked Playwright-MCP and Codex dev-server artifacts, add focused ignore rules, exclude the same output from Docker contexts, and update repository metadata. This is reversible, does not alter runtime assets, and can be verified through the existing CI workflow.

### B. Git LFS or release-hosted model assets

Move the bundled ONNX model weights out of normal Git storage and add a verified fetch/staging process. This could materially reduce clone size, but it changes development, CI, Docker, desktop packaging, and air-gapped build behavior. It requires its own design and release strategy.

### C. Full history rewrite

Use `git filter-repo` to purge historical copies of generated artifacts and large binaries. This provides the largest storage reduction but rewrites every commit and forces all existing clones and branches to be reconciled. It is inappropriate as an unannounced maintenance change.

## Selected changes

1. Remove every tracked file under `.playwright-mcp/`.
2. Remove `.codex-devserver.log` and `.codex-devserver.err.log`.
3. Add targeted `.gitignore` rules for:
   - `.playwright-mcp/`
   - `.codex-devserver*.log`
   - `playwright-report/`
   - `test-results/`
   - `*.trace.zip`
4. Add matching `.dockerignore` entries, plus existing local agent configuration directories that are unnecessary in the image context.
5. Set a concise repository description and product-relevant topics.
6. Keep `.claude/launch.json`, production model assets, documentation binaries, and all runtime/build files unchanged.

## Repository metadata

**Description:** `Private, local-first 2D/3D knowledge graphs for documents and source repositories.`

**Topics:**

- `knowledge-graph`
- `document-analysis`
- `local-first`
- `semantic-search`
- `threejs`
- `react-three-fiber`
- `webgpu`
- `openusd`
- `electron`
- `typescript`

## Validation

- Confirm the cleanup branch contains no paths under `.playwright-mcp/` and no root Codex dev-server logs.
- Confirm all new ignore patterns are present in `.gitignore` and `.dockerignore`.
- Compare the branch against `main` to ensure no production source, models, packaging scripts, or user documentation were removed.
- Run the complete CI workflow: lint, type-check, tests, standard build, air-gapped build, bundle checks, Windows packaging validation, Docker build, and container smoke test.

## Non-goals

- No Git history rewrite.
- No Git LFS introduction.
- No movement or deletion of ONNX, OCR, demo, icon, installer, or documentation assets.
- No application, build-command, security-policy, or release-format changes.
