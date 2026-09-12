import type { AppSnapshot, PostView, SettingsUpdate } from '../../shared/api';
import type { SignalLevel } from '../../shared/domain';
export type PageId = 'overview' | 'inbox' | 'sources' | 'notifications' | 'settings';
export type Filter = 'all' | Exclude<SignalLevel, 'irrelevant'>;
export type Theme = 'light' | 'dark';
export type SaveSettings = (patch: SettingsUpdate) => Promise<boolean>;
export const labels: Record<SignalLevel, string> = { confirmed: '确认重置', preview: '预告', related: '相关', irrelevant: '无关' };
export const sourceName = (id: string) => id === 'x-browser' ? 'Chrome 扩展' : id === 'public-rss' ? '公共 RSS' : id;
export const levelOf = (item: PostView): SignalLevel => item.classification?.level ?? 'irrelevant';
export function explanation(item: PostView): string {
  if (!item.classification) return '这条动态还在等待判断。';
  return { confirmed: 'Tibo 已宣布重置完成或正在执行。个人额度是否到账，请以账户实际显示为准。',
    preview: 'Tibo 提到了接下来的重置计划，目前尚未宣布完成。',
    related: '这条涉及用量或产品限制，但没有明确宣布本次重置。',
    irrelevant: '这条没有提到需要提醒的重置或用量变化。' }[item.classification.level];
}
export function formatTime(value: string | null): string {
  return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—';
}
export function formatDay(value: string | null): string {
  return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)).replaceAll('/', '-') : '—';
}
export const fullDate = (value: string | null) => value ? `${formatDay(value)} ${formatTime(value)}` : '—';
export function filteredPosts(posts: PostView[], filter: Filter, query = '') {
  const term = query.trim().toLowerCase();
  return posts.filter(item => (filter === 'all' || levelOf(item) === filter) && `${item.post.text} ${item.post.quotedText ?? ''}`.toLowerCase().includes(term));
}
export function healthFor(snapshot: AppSnapshot, sourceId: string) {
  const enabled = sourceId === 'x-browser' ? snapshot.settings.browserSourceEnabled : snapshot.settings.publicRssEnabled;
  const source = snapshot.sourceHealth.find(item => item.sourceId === sourceId);
  return { sourceId, label: sourceName(sourceId), consecutiveFailures: 0, lastCheckedAt: null, lastSuccessAt: null,
    ...source, state: enabled ? source?.state ?? 'syncing' : 'disabled', errorCode: enabled ? source?.errorCode ?? null : null } as const;
}
