import { describe, expect, it } from 'vitest';

import { buildEmailMessage, emailSettingsSchema, retryDelayMinutes } from '../../src/main/notifications/email';
import type { ClassificationResult, MonitoredPost, SignalEvent } from '../../src/shared/domain';

const post: MonitoredPost = {
  id: '400',
  authorHandle: 'thsottiaux',
  text: "I've now reset Codex usage limits.",
  createdAt: '2026-07-31T04:53:19.000Z',
  url: 'https://x.com/thsottiaux/status/400',
  kind: 'original',
  quotedText: null,
  sourceIds: ['public-rss', 'x-browser'],
};
const classification: ClassificationResult = {
  level: 'confirmed',
  score: 10,
  reasons: ['明确表示额度已经重置'],
  matchedTerms: ['Codex', 'reset'],
  classifierVersion: 'rules-v1',
};
const event: SignalEvent = {
  id: 'event-400',
  postId: '400',
  level: 'confirmed',
  previousLevel: 'preview',
  isEscalation: true,
  detectedAt: '2026-07-31T05:00:00.000Z',
};

describe('email notification', () => {
  it('validates STARTTLS and SSL settings with multiple normalized recipients', () => {
    const value = emailSettingsSchema.parse({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      username: 'sender@example.com',
      from: 'Tibo Watch <sender@example.com>',
      recipients: [' first@example.com ', 'second@example.com'],
    });
    expect(value.recipients).toEqual(['first@example.com', 'second@example.com']);
    expect(() => emailSettingsSchema.parse({ ...value, port: 70_000 })).toThrow();
  });

  it('builds the confirmed subject and includes Beijing time, reasons, sources, and link', () => {
    const message = buildEmailMessage(event, post, classification);
    expect(message.subject).toBe('[Tibo Watch][确认] Codex 重置已宣布');
    expect(message.text).toContain("I've now reset Codex usage limits.");
    expect(message.text).toContain('2026年7月31日 12:53:19');
    expect(message.text).toContain('明确表示额度已经重置');
    expect(message.text).toContain('公共 RSS、X 登录会话');
    expect(message.text).toContain(post.url);
  });

  it('uses the preview subject and the required 1/5/15 minute retry delays', () => {
    expect(buildEmailMessage({ ...event, level: 'preview' }, post, { ...classification, level: 'preview' }).subject)
      .toBe('[Tibo Watch][预告] 可能即将重置');
    expect([0, 1, 2, 3].map(retryDelayMinutes)).toEqual([1, 5, 15, null]);
  });
});
