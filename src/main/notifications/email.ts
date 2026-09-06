import { z } from 'zod';

import type { ClassificationResult, MonitoredPost, SignalEvent } from '../../shared/domain';

export const emailSettingsSchema = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65_535),
  secure: z.boolean(),
  username: z.string().trim().min(1),
  from: z.string().trim().min(3),
  recipients: z
    .array(z.string().trim().email().transform((value) => value.toLowerCase()))
    .min(1)
    .transform((values) => [...new Set(values)]),
});

export type EmailSettings = z.infer<typeof emailSettingsSchema>;

export interface EmailMessage {
  subject: string;
  text: string;
}

const SOURCE_LABELS: Record<string, string> = {
  'public-rss': '公共 RSS',
  'x-browser': 'Chrome 登录共享',
};

export function retryDelayMinutes(attempt: number): number | null {
  return [1, 5, 15][attempt] ?? null;
}

export function buildEmailMessage(
  event: SignalEvent,
  post: MonitoredPost,
  classification: ClassificationResult,
): EmailMessage {
  const subject =
    event.level === 'confirmed'
      ? '[Tibo Watch][确认] Codex 重置已宣布'
      : '[Tibo Watch][预告] 可能即将重置';
  const beijingTime = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(new Date(post.createdAt))
    .replace(/\s+/g, ' ');
  const sourceStatus = post.sourceIds
    .map((sourceId) => SOURCE_LABELS[sourceId] ?? sourceId)
    .join('、');

  return {
    subject,
    text: [
      event.level === 'confirmed' ? '检测到 Codex 重置确认动态。' : '检测到可能的 Codex 重置预告。',
      '',
      `原文：${post.text}`,
      post.quotedText ? `引用内容：${post.quotedText}` : null,
      `发布时间（北京时间）：${beijingTime}`,
      `判定依据：${classification.reasons.join('；')}`,
      `判定证据：${classification.matchedTerms.join('、') || '无'}`,
      `来源状态：${sourceStatus || '未知来源'}`,
      `原帖链接：${post.url}`,
      '',
      '说明：“确认重置”仅代表 Tibo 已明确公告，不保证个人 Codex 额度已同步到账。',
    ]
      .filter((line): line is string => line !== null)
      .join('\n'),
  };
}
