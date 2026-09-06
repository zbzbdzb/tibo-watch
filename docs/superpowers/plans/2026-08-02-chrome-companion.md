# Chrome Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the user's active Chrome X login for read-only Tibo monitoring without transferring browser credentials.

**Architecture:** A fixed-ID Manifest V3 extension extracts visible X DOM and submits normalized posts to a loopback-only Electron bridge. A companion adapter implements the existing `XBrowserAdapter`, preserving all downstream monitoring and notification behavior.

**Tech Stack:** Electron 43, TypeScript 6, Node HTTP, Zod, Chrome Manifest V3, Vitest, Playwright Electron, electron-builder.

## Global Constraints

- Do not read, copy, export, or store cookies, passwords, profiles, local storage, session storage, or session tokens.
- Do not post, reply, like, repost, follow, or modify the X account.
- Accept bridge traffic only from `chrome-extension://cnhojdncaimngpikaokmgpnihhglnmkn` on `127.0.0.1:47652`.
- Preserve public RSS, SQLite history, SMTP credentials, notification behavior, and the five-minute default interval.

---

### Task 1: Extension DOM parser and package

**Files:**
- Create: `chrome-extension/manifest.json`
- Create: `chrome-extension/service-worker.js`
- Test: `tests/chrome-extension/serviceWorker.test.ts`

**Interfaces:**
- Produces `collectVisiblePosts(document): ChromePost[]` and POST payload `{ posts: ChromePost[], pageUrl: string }`.

- [ ] Write parser fixture tests for original, reply, quote, repost, and foreign-author rows.
- [ ] Run `pnpm exec vitest run tests/chrome-extension/serviceWorker.test.ts` and verify the missing implementation fails.
- [ ] Implement the self-contained parser, two inactive monitor tabs, five-minute alarm, and loopback POST.
- [ ] Re-run the focused test and verify it passes.

### Task 2: Loopback bridge and companion adapter

**Files:**
- Create: `src/main/sources/chromeCompanionBridge.ts`
- Create: `src/main/sources/chromeCompanionSession.ts`
- Test: `tests/sources/chromeCompanionBridge.test.ts`
- Test: `tests/sources/chromeCompanionSession.test.ts`

**Interfaces:**
- Produces `ChromeCompanionBridge.start()`, `.stop()`, `.isConnected()`, `.readPosts()`.
- Produces `ChromeCompanionSession implements XBrowserAdapter` with `openLogin()` and `logout()`.

- [ ] Write failing HTTP tests for the allowed origin, rejected origin, malformed body, and bounded body.
- [ ] Write failing adapter tests for freshness, offline state, and post delivery.
- [ ] Implement Zod validation, loopback server lifecycle, freshness tracking, and adapter delegation.
- [ ] Run both focused test files and verify they pass.

### Task 3: Electron integration and settings UI

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/shared/api.ts`
- Modify: `tests/renderer/appInteractions.test.tsx`
- Modify: `tests/e2e/app.spec.ts`

**Interfaces:**
- Existing `browserSourceEnabled` controls the companion source.
- Existing `openXLogin()` becomes the extension setup/open action.
- Existing `xLoggedIn` means the extension delivered a recent valid batch.

- [ ] Write failing renderer and Electron tests for “Chrome 登录共享”, connection state, and setup action.
- [ ] Replace `ElectronXSession` construction with bridge/session lifecycle and source label changes.
- [ ] Update settings copy and warnings without changing SMTP or RSS controls.
- [ ] Run focused renderer and Electron tests and verify they pass.

### Task 4: Packaging, documentation, and installation

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `PRIVACY.md`
- Modify: `tests/main/trayIcon.test.ts`

**Interfaces:**
- `resources/chrome-extension/manifest.json` and `service-worker.js` must exist in packaged output.

- [ ] Extend the packaging test to require the Chrome extension resource directory.
- [ ] Add `chrome-extension` to `extraResources` and document the one-time Chrome installation procedure.
- [ ] Bump the application version to `0.2.0`.
- [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, and `pnpm dist:win`.
- [ ] Verify packaged extension resources, install for the current user, launch, and confirm version and source status.
