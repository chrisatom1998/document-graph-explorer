# README Landing Page Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `README.md` into a product-first GitHub landing page that explains Document Graph Explorer quickly, establishes its privacy and engineering credibility, and gives visitors clear actions without removing the existing technical documentation.

**Architecture:** Replace the README’s opening hierarchy while preserving the deep documentation below it. Use GitHub-compatible Markdown/HTML, existing repository assets, direct links to the live app and releases, and accurate claims grounded in the current security and benchmark documents.

**Tech Stack:** GitHub Flavored Markdown, repository-relative assets, Shields.io badges, existing Vite/React/TypeScript project documentation.

## Global Constraints

- Lead with the normal in-app workflow, not downstream OpenUSD tooling.
- Do not claim all AI is local: core graph processing is local, OpenRouter is opt-in cloud, and Ollama is local.
- Preserve the distinction between runtime offline mode and the enforced air-gapped build.
- Tie performance claims to `docs/benchmarks.md` and its stated test hardware.
- Use existing repository assets only; do not add a synthetic application screenshot.
- Preserve all accurate build, desktop, architecture, testing, and deployment instructions.
- Do not add a new runtime or documentation dependency.

---

### Task 1: Rewrite the README’s product-facing hierarchy

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `public/icon.svg`, `docs/benchmarks.md`, `SECURITY.md`, `docs/user-guide.md`, `docs/openusd-pipeline.md`, GitHub Releases, and the Vercel deployment.
- Produces: A complete `README.md` whose first screen contains the product identity, concise value proposition, trust badges, and primary actions.

- [ ] **Step 1: Replace the current opening with a centered product hero**

Use `public/icon.svg` above the title, followed by this message hierarchy:

```markdown
A private, local-first 2D/3D knowledge map for documents and source repositories.

Drop in PDFs, Markdown, Office files, HTML, text, or code. Document Graph Explorer finds topics, entities, references, and semantic relationships entirely in your browser—then turns the corpus into an explorable graph you can search, read, synchronize, and export.
```

Add badges for CI, latest release, GPL-3.0, TypeScript, and local-first processing. Add prominent links for **Try the live app**, **Read the user guide**, **Download a release**, and **Review the security model**.

- [ ] **Step 2: Add a compact product workflow section**

Describe the core loop as three stages:

```markdown
1. Drop a folder or load the demo corpus.
2. Let local workers parse, embed, connect, and cluster the files.
3. Explore the graph, inspect evidence, search passages, ask questions, and keep a watched folder synchronized.
```

Include measured proof points from `docs/benchmarks.md`: approximately 11 documents/second for the 100-PDF demo corpus on the documented Apple M5 Max test machine, layout convergence under six seconds at 2,000 nodes, and display-capped 120 Hz rendering through the tested 2,000-node corpus. State these as one measured data point, not universal guarantees.

- [ ] **Step 3: Replace the early long-form feature list with a scannable capability table**

Use rows for:

- Local semantic graph
- Multi-format ingestion and OCR
- Source-repository understanding
- Search and document reader
- Multiple corpora and live folder sync
- Notes, tags, snapshots, and comparison
- Optional OpenRouter/Ollama AI
- Share URLs, JSON/PNG, and OpenUSD export
- Normal, offline, air-gapped, web, and desktop distribution paths

Each description must remain one or two sentences and link to deeper documentation where useful.

- [ ] **Step 4: Move OpenUSD imagery and explanation below the core product story**

Keep the existing three-image table and detailed OpenUSD instructions intact, but introduce them as an advanced interoperability capability rather than the opening product identity.

- [ ] **Step 5: Preserve and lightly tighten the existing engineering sections**

Retain accurate content for:

- Quick start and scripts
- Build modes
- Desktop packaging and launchers
- Pipeline architecture
- Tech stack
- Testing
- Deployment/security headers

Remove repeated explanations only when the same information already appears earlier and the deeper section remains complete.

- [ ] **Step 6: Commit the README rewrite**

```bash
git add README.md
git commit -m "docs: refresh repository landing page"
```

### Task 2: Verify links, claims, and Markdown structure

**Files:**
- Verify: `README.md`
- Reference: `docs/benchmarks.md`
- Reference: `SECURITY.md`
- Reference: `package.json`

**Interfaces:**
- Consumes: The rewritten README from Task 1.
- Produces: A landing page with valid repository-relative references and no unsupported product claims.

- [ ] **Step 1: Verify local README links resolve to tracked paths**

Run this dependency-free check from the repository root:

```bash
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const text = fs.readFileSync('README.md', 'utf8');
const targets = [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
  .map((match) => match[1])
  .filter((target) => !/^(https?:|mailto:|#)/.test(target))
  .map((target) => target.split('#')[0])
  .filter(Boolean);
const missing = [...new Set(targets)].filter((target) => !fs.existsSync(path.resolve(target)));
if (missing.length) {
  console.error('Missing README targets:\n' + missing.join('\n'));
  process.exit(1);
}
console.log(`Verified ${new Set(targets).size} repository-relative README targets.`);
NODE
```

Expected: exit code 0 and no missing targets.

- [ ] **Step 2: Verify performance language against the benchmark document**

Confirm the README says the measurements were taken on the documented Apple M5 Max setup and does not generalize the results to all hardware.

- [ ] **Step 3: Verify privacy language against the security document**

Confirm the README distinguishes:

- Default local processing with no document upload
- Opt-in OpenRouter requests
- Local Ollama requests
- Runtime offline mode
- Enforced air-gapped build
- Collaboration signaling and its explicit opt-in behavior

- [ ] **Step 4: Check formatting and repository quality gates**

```bash
git diff --check main...HEAD
npm run lint
npm run typecheck
```

Expected: all commands exit 0. The code checks should remain unchanged because the implementation is documentation-only.

- [ ] **Step 5: Commit any verification corrections**

```bash
git add README.md
git commit -m "docs: correct landing page links and claims"
```

Skip this commit when verification requires no corrections.

### Task 3: Review the final change as a GitHub landing page

**Files:**
- Review: `README.md`
- Review: `docs/superpowers/specs/2026-08-15-readme-landing-page-design.md`
- Review: `docs/superpowers/plans/2026-08-15-readme-landing-page.md`

**Interfaces:**
- Consumes: The validated README branch.
- Produces: A focused pull request ready for human review.

- [ ] **Step 1: Review the first viewport for comprehension**

A new visitor should be able to answer these questions without scrolling deeply:

1. What does the product do?
2. Why is it different?
3. Does it upload my documents?
4. Where can I try it?
5. Where can I download or learn more?

- [ ] **Step 2: Review the complete diff for accidental documentation loss**

```bash
git diff --stat main...HEAD
git diff -- README.md
```

Confirm that build commands, desktop instructions, OpenUSD guidance, architecture notes, test instructions, and deployment notes remain represented.

- [ ] **Step 3: Open the pull request**

Use this title:

```text
docs: make the repository landing page product-first
```

The PR body should summarize the new hero and action links, the reordered product story, retained technical documentation, and the completed link/claim verification.
