# Semantic Reset Classifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace phrase-specific reset classification with composable semantic evidence and reclassify stored posts safely.

**Architecture:** Keep the existing `Classifier` interface and SQLite history. Refactor the local rules implementation into evidence extraction plus precedence-based classification; bump its version so the existing startup reclassification path updates stored posts and emits only valid upgrades.

**Tech Stack:** TypeScript, Vitest, Electron, SQLite, React, Playwright Electron.

## Global Constraints

- No external AI or network classifier.
- `matchedTerms` contains only source-text evidence used by the decision.
- Explicit negation and non-quota reset objects suppress preview/confirmed levels.
- Existing event uniqueness and first-baseline behavior remain unchanged.

---

### Task 1: Lock the classification contract with failing tests

**Files:**
- Modify: `tests/domain/classifier.test.ts`

**Interfaces:**
- Consumes: `classifyPost(input: ClassificationInput): Promise<ClassificationResult>`
- Produces: behavioral coverage for future timing, completion, negation, excluded objects and evidence labels.

- [ ] Add the real `reset everyone / next hour` text and assert `preview`, `reset`, `everyone`, `next hour`, and a future-time reason.
- [ ] Assert the Monday post remains `preview` while `matchedTerms` excludes `performative reset` and includes `Monday`.
- [ ] Add table-driven future, completion, negative, question and unrelated fixtures with literal expected levels.
- [ ] Run `pnpm test tests/domain/classifier.test.ts` and verify failures occur in the old product-keyword and future-intent branches.

### Task 2: Implement composable evidence extraction

**Files:**
- Modify: `src/main/classifier/ruleClassifier.ts`
- Test: `tests/domain/classifier.test.ts`

**Interfaces:**
- Produces: unchanged public `classifyPost` and `RuleClassifier`, with classifier version `rules-v4`.

- [ ] Add reusable match collection that preserves the actual source phrase and deduplicates case-insensitively.
- [ ] Extract action, product/quota, audience, continuity, future-time, future-commitment, completion, question, cancellation and excluded-object evidence independently.
- [ ] Apply precedence: cancellation/exclusion, preview, confirmed, related, irrelevant.
- [ ] Build evidence-specific Chinese reasons and include only contributing terms in `matchedTerms`.
- [ ] Run the focused classifier tests until green, then run the full unit suite.

### Task 3: Verify stored-post upgrade behavior

**Files:**
- Modify: `tests/monitoring/monitorCoordinator.test.ts`

**Interfaces:**
- Consumes: `MonitorCoordinator.reclassifyStoredPosts()` and `rules-v3` results.
- Produces: proof that a stored `related` item upgrades once to `preview` without duplicate events.

- [ ] Replace the phrase-specific reclassification fixture with the real next-hour announcement and literal evidence expectations.
- [ ] Run the focused monitoring test, confirm the assertion fails against old expectations if applicable, then pass with `rules-v3`.

### Task 4: Version, package, and install

**Files:**
- Modify: `package.json`
- Modify: `chrome-extension/manifest.json`
- Modify: `src/renderer/demoData.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: Windows installer `release/Tibo-Watch-Setup-0.2.5.exe`.

- [ ] Bump product and companion extension versions to `0.2.5`.
- [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e`.
- [ ] Run `pnpm dist:win` and execute the Electron suite against `release/win-unpacked/Tibo Watch.exe`.
- [ ] Silently install the new per-user package, restart the app, and verify product version, bridge listener, stored reclassification, SMTP recipients, and Public RSS setting preservation.
