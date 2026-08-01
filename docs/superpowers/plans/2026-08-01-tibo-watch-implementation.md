# Tibo Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checklist tracking in the active session.

**Goal:** Build a Windows Electron application that monitors Tibo's public posts for Codex reset confirmations and previews, then alerts through Windows and SMTP email.

**Architecture:** Electron's main process owns scheduling, sources, SQLite, notifications and encrypted settings. A sandboxed React renderer communicates through validated IPC, while an isolated persistent Electron session handles optional X login scraping.

**Tech Stack:** Electron, React, TypeScript, Vite, SQLite, Nodemailer, Zod, Vitest, Playwright Electron, electron-builder.

## Global Constraints

- Fixed account: `@thsottiaux`; default interval: five minutes.
- Default classifier is deterministic and local; the AI classifier remains an interface only.
- Confirmed and preview signals use audible Windows notifications plus email; related signals are silent Windows notifications.
- First synchronization establishes a baseline and never backfills alerts.
- The accepted dashboard and settings images in `docs/design/` are the visual source of truth.
- UI is Simplified Chinese, persisted timestamps are UTC, display timezone is Asia/Shanghai.
- Windows 10 22H2+ and Windows 11 x64 only; unsigned per-user NSIS installer.

## Execution Tasks

1. Scaffold the isolated Electron repository and preserve the accepted visual references.
2. Implement domain types, local classifier, SQLite migrations and event deduplication with test-first cycles.
3. Implement Nitter RSS and isolated X browser sources, scheduler and source health with test-first cycles.
4. Implement Windows/SMTP delivery, encrypted settings, tray lifecycle and validated IPC with test-first cycles.
5. Build the complete React interface from the accepted concepts and verify working interactions.
6. Run unit, integration, Electron E2E, native-size visual comparison, build and NSIS packaging checks.
