# Repository Hygiene Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove tracked local-development artifacts, prevent their return, and reduce Docker build-context noise without changing runtime or offline-build behavior.

**Architecture:** Apply one atomic Git tree commit for all tracked-file deletions and ignore-rule changes. Keep production binaries, model assets, application source, build commands, and repository settings unchanged.

**Tech Stack:** GitHub Contents/Git Data APIs, Git ignore rules, Docker ignore rules, existing GitHub Actions CI.

## Global Constraints

- Do not rewrite Git history.
- Do not introduce Git LFS.
- Do not move or delete ONNX, OCR, demo, icon, installer, or documentation assets.
- Do not change application source, build commands, security policy, release formats, or repository settings.
- Delete only `.playwright-mcp/*`, `.codex-devserver.log`, and `.codex-devserver.err.log`.
- Preserve `.claude/launch.json`.
- The final branch must pass the existing complete CI workflow.

---

### Task 1: Remove ephemeral tracked files and prevent recurrence

**Files:**
- Modify: `.gitignore`
- Modify: `.dockerignore`
- Delete: `.codex-devserver.log`
- Delete: `.codex-devserver.err.log`
- Delete: `.playwright-mcp/console-2026-07-10T19-47-02-154Z.log`
- Delete: `.playwright-mcp/console-2026-07-10T19-48-02-928Z.log`
- Delete: `.playwright-mcp/console-2026-07-10T20-24-00-131Z.log`
- Delete: `.playwright-mcp/console-2026-07-10T20-26-52-697Z.log`
- Delete: `.playwright-mcp/console-2026-07-12T03-47-11-014Z.log`
- Delete: `.playwright-mcp/console-2026-07-12T04-31-56-759Z.log`
- Delete: `.playwright-mcp/console-2026-07-12T04-34-52-198Z.log`
- Delete: `.playwright-mcp/console-2026-07-12T04-40-53-889Z.log`
- Delete: `.playwright-mcp/console-2026-07-12T05-09-26-513Z.log`
- Delete: `.playwright-mcp/page-2026-07-10T19-47-03-530Z.yml`
- Delete: `.playwright-mcp/page-2026-07-10T20-24-17-642Z.yml`
- Delete: `.playwright-mcp/page-2026-07-10T20-24-25-049Z.yml`
- Delete: `.playwright-mcp/page-2026-07-10T20-24-52-209Z.yml`
- Delete: `.playwright-mcp/page-2026-07-10T20-24-55-000Z.yml`
- Delete: `.playwright-mcp/page-2026-07-12T03-47-11-947Z.yml`
- Delete: `.playwright-mcp/page-2026-07-12T03-47-18-957Z.yml`
- Delete: `.playwright-mcp/page-2026-07-12T03-47-51-767Z.yml`
- Delete: `.playwright-mcp/page-2026-07-12T03-48-31-882Z.yml`
- Delete: `.playwright-mcp/page-2026-07-12T04-34-52-605Z.yml`
- Delete: `.playwright-mcp/page-2026-07-12T04-34-59-360Z.yml`
- Delete: `.playwright-mcp/page-2026-07-12T04-35-29-436Z.yml`
- Delete: `.playwright-mcp/page-2026-07-12T04-40-54-612Z.yml`
- Delete: `.playwright-mcp/page-2026-07-12T04-41-01-507Z.yml`
- Delete: `.playwright-mcp/page-2026-07-12T04-41-31-659Z.yml`
- Delete: `.playwright-mcp/page-2026-07-12T05-09-27-201Z.yml`
- Delete: `.playwright-mcp/page-2026-07-12T05-09-36-395Z.yml`
- Delete: `.playwright-mcp/page-2026-07-12T05-10-11-278Z.yml`

**Interfaces:**
- Consumes: Current `main` tree plus the existing `.gitignore` and `.dockerignore` content.
- Produces: A branch tree with no tracked local browser/session logs and focused rules that prevent recurrence.

- [ ] **Step 1: Update `.gitignore`**

Append this block, preserving all current rules:

```gitignore

# Local browser automation and agent development output
.playwright-mcp/
.codex-devserver*.log
playwright-report/
test-results/
*.trace.zip
```

- [ ] **Step 2: Update `.dockerignore`**

Append this block, preserving all current rules:

```dockerignore

# Local browser automation and agent configuration
.playwright-mcp
.codex
.cursor
.codex-devserver*.log
playwright-report
test-results
*.trace.zip
```

- [ ] **Step 3: Create one Git tree containing both modified ignore files and all deletions**

Create UTF-8 blobs for the complete replacement contents of `.gitignore` and `.dockerignore`. Create a tree based on the branch head tree with those two blobs and a `sha: null` entry for every deletion listed above.

- [ ] **Step 4: Commit and advance the branch**

Commit message:

```text
chore: remove committed local tooling artifacts
```

Move `chore/repository-hygiene` to the resulting commit without force.

- [ ] **Step 5: Verify the resulting tree**

Confirm all of the following:

```text
No path starts with .playwright-mcp/
.codex-devserver.log is absent
.codex-devserver.err.log is absent
.gitignore contains .playwright-mcp/ and .codex-devserver*.log
.dockerignore contains .playwright-mcp and .codex-devserver*.log
public/models/Xenova/bge-small-en-v1.5/onnx/model_fp16.onnx remains present
public/models/Xenova/bge-small-en-v1.5/onnx/model_quantized.onnx remains present
.claude/launch.json remains present
```

### Task 2: Review, open the pull request, and verify CI

**Files:**
- Review: `.gitignore`
- Review: `.dockerignore`
- Review: deleted artifact paths
- Review: `docs/superpowers/specs/2026-08-15-repository-hygiene-design.md`
- Review: `docs/superpowers/plans/2026-08-15-repository-hygiene.md`

**Interfaces:**
- Consumes: The completed cleanup branch.
- Produces: A focused pull request with CI evidence and no unresolved review findings.

- [ ] **Step 1: Compare the branch with `main`**

Expected change categories:

```text
2 modified ignore files
29 deleted local-tool artifacts
2 added design/plan documents
0 application source changes
0 model/runtime asset changes
```

- [ ] **Step 2: Open the pull request**

Title:

```text
chore: remove committed local tooling artifacts
```

The body must explain the removed Playwright/Codex files, new ignore rules, tighter Docker context, and unchanged runtime assets. It should also include the recommended out-of-band repository description and topics because the available integration does not expose repository-settings writes.

- [ ] **Step 3: Run the complete existing CI workflow**

Required successful checks:

```text
Lint
Type-check
Test
Build (production)
Build (air-gapped) + verify zero external hosts
Enforce eager bundle budget
Build (Windows .exe) + verify icon embedded
Docker build
Container smoke test
```

- [ ] **Step 4: Review automated comments**

Address any valid inline finding with a follow-up commit, reply with the fixing commit SHA, resolve the thread, and wait for the newest commit's CI run before reporting completion.
