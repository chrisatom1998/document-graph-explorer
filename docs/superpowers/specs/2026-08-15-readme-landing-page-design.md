# README Landing Page Refresh — Design

**Date:** 2026-08-15  
**Status:** Approved for implementation  
**Scope:** GitHub repository landing page (`README.md`)

## Goal

Make the repository’s first screen explain the product in seconds, establish trust in its local-first architecture, and give visitors obvious paths to try, install, or understand it—without weakening the detailed technical documentation already in the README.

## Audience

1. Developers evaluating the project from GitHub.
2. Technical teams looking for private document and source-code exploration.
3. Potential contributors who need a fast mental model before reading implementation details.

## Approaches considered

### A. Minimal hero rewrite

Replace only the first paragraphs and add badges/buttons. This is low risk, but it leaves the current OpenUSD-first visual hierarchy and long feature exposition largely unchanged.

### B. Product-first README restructure — selected

Create a compact hero, proof-oriented value section, clear quick-start choices, and a short feature grid. Move OpenUSD screenshots and deep technical explanation below the core product story. Preserve existing commands, architecture notes, desktop instructions, security claims, and technical references.

### C. Separate marketing website

Build a dedicated web landing page outside the application. This offers the most visual control, but it is unnecessary for the immediate GitHub discovery problem and would create another surface to maintain.

## Information architecture

The refreshed README will follow this order:

1. **Hero:** icon, name, one-sentence value proposition, concise supporting sentence.
2. **Trust and status:** CI, release, license, privacy, and TypeScript badges.
3. **Primary actions:** live demo, user guide, releases, security model.
4. **Product proof:** a short “drop → connect → explore” explanation and measured performance facts.
5. **Why it is different:** local-first processing, evidence-backed relationships, live folder synchronization, and optional local/cloud AI.
6. **Quick start:** browser demo first, local development second, packaged builds third.
7. **Feature highlights:** scannable capability table instead of a long opening list.
8. **OpenUSD interoperability:** existing screenshots and detailed export explanation, clearly positioned as an advanced capability.
9. **Existing engineering documentation:** builds, desktop distribution, architecture, stack, tests, and deployment notes.

## Content rules

- Lead with the normal in-app workflow, not downstream OpenUSD tooling.
- Avoid claiming that all AI is local; core graph intelligence is local, while OpenRouter is explicitly opt-in and Ollama is local.
- Retain the air-gapped build distinction from the runtime offline toggle.
- Keep benchmark claims tied to the published benchmark document and identified hardware.
- Use existing repository assets only; do not add a synthetic product screenshot.
- Keep the README useful as documentation, not merely marketing copy.

## Visual treatment

GitHub-compatible HTML will center the product icon, title, description, badges, and primary links. The existing OpenUSD screenshots remain in a three-column table under the interoperability section. No external image CDN or tracking badge service will be introduced beyond standard GitHub/Shields badge rendering.

## Validation

- Check every relative file and anchor link referenced by the rewritten README.
- Confirm badge URLs and live-demo/release links are valid.
- Ensure all current build commands and security descriptions remain accurate.
- Review the final diff to verify that deep technical sections were preserved rather than accidentally removed.
