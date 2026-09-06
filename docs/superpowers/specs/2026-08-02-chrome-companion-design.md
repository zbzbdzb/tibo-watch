# Chrome Companion Design

## Goal

Replace the Electron-owned X login flow with monitoring that reuses the user's already signed-in Chrome session without reading, copying, exporting, or storing cookies, passwords, or session tokens.

## Chosen architecture

Tibo Watch ships a fixed-ID Manifest V3 extension. The extension creates or reuses inactive tabs for `https://x.com/thsottiaux` and `https://x.com/thsottiaux/with_replies`, extracts only visible tweet DOM, ignores pure reposts, and posts normalized public post data to an HTTP bridge bound to `127.0.0.1:47652`.

The Electron main process starts the bridge and accepts requests only from `chrome-extension://cnhojdncaimngpikaokmgpnihhglnmkn`. Zod validates the bounded payload. A `ChromeCompanionSession` implements the existing `XBrowserAdapter`, so classification, deduplication, baselining, Windows notifications, and email delivery remain unchanged.

No browser credential material crosses the bridge. The extension transmits only post ID, Tibo handle, post text, quoted text, timestamp, kind, and public X URL.

## User experience

The settings page labels the source “Chrome 登录共享”. Before pairing, it shows “扩展未连接” and offers “安装/打开扩展”. That action reveals the packaged extension directory and opens the Tibo profile in the user's default browser. Chrome requires the user to enable Developer mode and choose “Load unpacked” once; the app cannot safely bypass this confirmation.

After installation, Chrome alarms run every five minutes. The extension reuses the current Chrome profile and login state, refreshes the two monitor tabs, collects visible posts, and sends them to Tibo Watch. The existing source toggle controls whether received data participates in checks.

## Security boundaries

- Bind the bridge only to IPv4 loopback.
- Reject origins other than the fixed extension origin.
- Limit request bodies to 256 KiB and reject malformed or foreign-author posts.
- Never expose Cookie APIs, Chrome profile paths, local/session storage, passwords, or tokens.
- Keep X actions read-only: no posting, replying, liking, following, or reposting.
- Retain the existing public RSS fallback and SMTP configuration.

## Failure handling

If the extension has not delivered a valid payload within ten minutes, the X source reports `needs_login` with `CHROME_COMPANION_OFFLINE`. A port conflict reports an error without crashing the app. Empty but valid batches keep the bridge online and do not generate notifications.

## Testing

- Parser fixture tests cover originals, replies, quotes, foreign posts, and reposts.
- Bridge tests cover origin rejection, payload validation, size limits, and timestamp freshness.
- Adapter tests cover connected/offline state and batch delivery.
- Electron tests verify the setup action and source label.
- Packaging verification confirms the extension manifest and scripts exist in `resources/chrome-extension`.
