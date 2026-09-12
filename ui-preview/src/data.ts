export type PageId = 'overview' | 'inbox' | 'sources' | 'notifications' | 'settings';
export type Level = 'confirmed' | 'preview' | 'related';
export type Filter = 'all' | Level;
export type Scenario = 'monitoring' | 'confirmed' | 'preview' | 'outage';
export interface Post {
  id: string; level: Level; day: string; time: string; text: string; note: string;
  reason: string; kind: string; delivered: boolean;
}
export const levelLabels = { confirmed: '确认重置', preview: '预告', related: '相关' };
// All records are intentionally synthetic. No live database, credentials, bridge,
// RSS requests or notification APIs are used by this standalone preview.
export const posts: Post[] = [
  { id: 'demo-1', level: 'preview', day: '今天 9月12日', time: '16:42', kind: '回复',
    text: 'Reset will land around 14pm PST tomorrow.', note: '预计明日重置，请以实际公告为准。',
    reason: 'Tibo 说重置将在明天到来，目前还没有宣布完成。',
    delivered: true },
  { id: 'demo-2', level: 'confirmed', day: '今天 9月12日', time: '14:11', kind: '原创',
    text: 'Usage limits have been reset for all paid Codex subscriptions.', note: '已宣布执行，不代表个人额度已到账。',
    reason: 'Tibo 已宣布重置付费 Codex 订阅的用量限制。',
    delivered: true },
  { id: 'demo-3', level: 'related', day: '昨天 9月11日', time: '23:08', kind: '原创',
    text: 'Update on rate limits in Codex.', note: '有关速率限制的更新。',
    reason: '这条只提到 Codex 限制的更新，没有宣布重置。',
    delivered: false },
  { id: 'demo-4', level: 'preview', day: '昨天 9月11日', time: '20:34', kind: '回复',
    text: "I'll do another reset on Monday.", note: '计划在周一再次重置。',
    reason: 'Tibo 计划周一再重置一次，这是预告，还未执行。',
    delivered: true },
  { id: 'demo-5', level: 'confirmed', day: '9月10日', time: '11:20', kind: '原创',
    text: 'The banked reset has landed. Enjoy the new usage!', note: '重置已经完成，保留历史记录。',
    reason: 'Tibo 已宣布这次重置完成。',
    delivered: true },
  { id: 'demo-6', level: 'related', day: '9月10日', time: '09:18', kind: '引用',
    text: 'Thanks for all the feedback on Codex usage limits.', note: '反馈与讨论，不是重置公告。',
    reason: '这条是在感谢大家的反馈，没有宣布重置。', delivered: false },
  { id: 'demo-7', level: 'preview', day: '9月9日', time: '18:42', kind: '原创',
    text: 'There is a place and a time for resets. Soon, but not today.', note: '即将发生，但不是今天。',
    reason: 'Tibo 表示近期会重置，但不是今天，具体时间还没公布。',
    delivered: true },
  { id: 'demo-8', level: 'related', day: '9月9日', time: '10:05', kind: '回复',
    text: 'We are looking into the usage reports. More updates to follow.', note: '用量问题正在调查中。',
    reason: '目前只是在调查用量问题，没有宣布重置计划。', delivered: false },
];
export const pageTitles: Record<PageId, [string, string]> = {
  overview: ['监测总览', ''],
  inbox: ['动态收件箱', ''],
  sources: ['数据源', ''],
  notifications: ['通知', '决定哪些变化值得打扰，以及用什么方式。'],
  settings: ['设置', '让 Tibo Watch 按照你的习惯，安静运行。'],
};
