# Chrome Companion reliability repair (0.2.16)

## Scope and evidence

- Duplicate reply tabs occur because active tabs are excluded from reuse and active owned tabs from duplicate cleanup.
- Live reports continue arriving but report POSTS_LOADING; the desktop conflates an incomplete timeline with absence of fresh transport.
- Installed files alone cannot prove which collector is running; current reports lack collector version and collection reasons.
- Preserve the existing classifier, notifications, credentials, user settings and history. Never read browser credentials or close unidentified user tabs.

## Implementation

1. Persist the selected posts/replies tab IDs in session storage; prefer that tab across focus changes. Reuse active pages without reload/scroll. Re-query before destructive actions; close only inactive duplicates whose ownership and URL still match. Browser restart may discard ownership but must reuse matching restored tabs instead of creating more. Reuse the monitoring tab for bounded long-text expansion when inactive, restoring its original URL; never create a third detail tab.
2. Capture explicit readiness evidence: visible primary timeline cards (including skipped reposts), stable leading items rather than the entire virtualized viewport, pinned-only, empty, login, navigation and error conditions. After bounded capture, report a precise reason. Long-text completeness remains separate from timeline readiness. Respect an active user's page and do not reload, scroll or navigate it during sampling.
3. Add validated, bounded diagnostics with collector revision and extension version. Present actual received version and per-page result/reason/time/count in source details; no body text or account secrets in diagnostics. Detect old collectors, ignore late old reports after a current collector arrives, and keep the last successful result. Expired reports mean data timeout; fresh reports that repeatedly cannot complete mean collection incomplete, not network timeout.
4. Cover focus changes, restart/reuse, ownership loss, skipped reposts, persistent spinners, virtualization, pinned-only, detail fallback, old/new collector transition, and persistent incomplete vs transport timeout. Use isolated MV3 Chromium + Electron/renderer tests, then lint/typecheck/unit/build/e2e/package. Verify package contents and report installed vs packaged state truthfully.

## Delivery

Desktop and extension version 0.2.16. Existing 0.2.15 edits remain intact. No database migration or historical reclassification. The initial repair deliverable was a local installer, without GitHub publication. Final installation must not circumvent any execution-policy block. Chrome extension reload remains a user action if the browser does not expose an authorized reload path.

## Validation and handoff

- Implemented tab reuse across focus/worker changes, safe duplicate ownership checks, same-tab text expansion/recovery, repost-aware and virtualization-tolerant readiness, and versioned per-view diagnostics.
- Lint and both TypeScript configurations pass. Unit/integration suite: 355 tests pass.
- Electron/Chromium/renderer e2e suite: 19 tests pass, including three real MV3 collection cycles with focus changes, same-tab long-body expansion, no third X tab, both themes and diagnostic states.
- The real-browser collector test redirects X to synthetic pages in a fresh profile. It does not verify the user's live account or access credentials.
- Windows installer generated at `release/Tibo-Watch-Setup-0.2.16.exe`; bundled collector matches source by SHA-256.
- At the initial handoff the installed app was read-only verified as 0.2.15.0, so manual installation and Chrome extension reload remained required; no attempt was made to circumvent the installation-policy block.

## Follow-up installation and release

- The user manually installed 0.2.16. Read-only checks confirmed app version 0.2.16.0 and extension version 0.2.16, with the installed collector matching source by SHA-256.
- The installation directory changed. Chrome retained the removed extension directory, causing `File path cannot be resolved`; the user was given the verified new directory and instructions to reload from that location.
- The user confirmed the repair succeeded and explicitly requested GitHub publication. Release scope is the source changes, the already-validated Windows installer, a matching extension ZIP and checksums. Private databases, settings, credentials and browser profiles remain excluded.
