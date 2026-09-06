/* global chrome */
// No X permissions, user data, or automatic network activity. The transport test
// invokes fetch inside this real MV3 worker to retain Chromium header semantics.
chrome.runtime.onInstalled.addListener(() => {});
