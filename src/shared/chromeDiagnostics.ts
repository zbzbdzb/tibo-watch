export const CHROME_COLLECTOR_REVISION = 1;
export const COLLECTION_REASONS = [
  'stable_timeline', 'empty_timeline', 'pinned_only', 'unstable_timeline',
  'page_loading', 'login_required', 'page_error', 'navigation_changed',
  'read_failed', 'active_detail',
] as const;
export interface ChromePageDiagnostic {
  view: 'posts' | 'replies';
  extensionVersion: string | null;
  collectorRevision: number | null;
  result: string;
  reason: typeof COLLECTION_REASONS[number] | 'old_collector';
  checkedAt: string;
  receivedAt: string;
  postCount: number;
  pendingDetails: number;
  samples: number;
}
