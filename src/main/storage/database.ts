import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import type {
  ClassificationResult,
  MonitoredPost,
  SignalEvent,
  SignalLevel,
  SourceCheckResult,
  DeliveryReceipt,
} from '../../shared/domain';

export interface AppSettings {
  pollIntervalMinutes: number;
  browserSourceEnabled: boolean;
  publicRssEnabled: boolean;
  startAtLogin: boolean;
  closeToTray: boolean;
  baselineComplete: boolean;
  onboardingComplete: boolean;
  emailEnabled: boolean;
  emailRecipients: string[];
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpFrom: string;
}

export interface StoredClassification extends ClassificationResult {
  postId: string;
  createdAt: string;
}

export interface MailQueueItem {
  id: string;
  eventId: string;
  attempt: number;
  nextAttemptAt: string;
  lastError: string | null;
  status: 'pending' | 'sent' | 'failed';
}

const DEFAULT_SETTINGS: AppSettings = {
  pollIntervalMinutes: 5,
  browserSourceEnabled: false,
  publicRssEnabled: true,
  startAtLogin: true,
  closeToTray: true,
  baselineComplete: false,
  onboardingComplete: false,
  emailEnabled: false,
  emailRecipients: [],
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUsername: '',
  smtpFrom: '',
};

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function normalizeRecipients(values: string[]): string[] {
  const seen = new Set<string>();
  const recipients: string[] = [];

  for (const rawValue of values) {
    const value = rawValue.trim().toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    recipients.push(value);
  }

  return recipients;
}

export class AppDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.migrate();
  }

  schemaVersion(): number {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    return Number(row.user_version);
  }

  getSettings(): AppSettings {
    const row = this.db
      .prepare('SELECT value_json FROM app_settings WHERE id = 1')
      .get() as { value_json: string } | undefined;

    if (!row) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...parseJson<Partial<AppSettings>>(row.value_json) };
  }

  updateSettings(update: Partial<AppSettings>): AppSettings {
    const next = {
      ...this.getSettings(),
      ...update,
      emailRecipients: normalizeRecipients(
        update.emailRecipients ?? this.getSettings().emailRecipients,
      ),
    };

    if (!Number.isInteger(next.pollIntervalMinutes) || next.pollIntervalMinutes < 1) {
      throw new RangeError('pollIntervalMinutes must be a positive integer');
    }
    if (!Number.isInteger(next.smtpPort) || next.smtpPort < 1 || next.smtpPort > 65_535) {
      throw new RangeError('smtpPort must be between 1 and 65535');
    }

    this.db
      .prepare(
        `INSERT INTO app_settings (id, value_json, updated_at)
         VALUES (1, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(next));

    return next;
  }

  upsertPost(post: MonitoredPost): void {
    const existing = this.getPost(post.id);
    const sourceIds = [...new Set([...(existing?.sourceIds ?? []), ...post.sourceIds])];

    this.db
      .prepare(
        `INSERT INTO posts (
           id, author_handle, text, quoted_text, published_at, kind,
           url, source_ids_json, first_seen_at, last_seen_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           author_handle = excluded.author_handle,
           text = excluded.text,
           quoted_text = excluded.quoted_text,
           published_at = excluded.published_at,
           kind = excluded.kind,
           url = excluded.url,
           source_ids_json = excluded.source_ids_json,
           last_seen_at = CURRENT_TIMESTAMP`,
      )
      .run(
        post.id,
        post.authorHandle,
        post.text,
        post.quotedText ?? null,
        post.createdAt,
        post.kind,
        post.url,
        JSON.stringify(sourceIds),
      );
  }

  getPost(id: string): MonitoredPost | undefined {
    const row = this.db.prepare('SELECT * FROM posts WHERE id = ?').get(id) as
      | Record<string, string | null>
      | undefined;
    return row ? this.mapPost(row) : undefined;
  }

  listPosts(): MonitoredPost[] {
    const rows = this.db
      .prepare('SELECT * FROM posts ORDER BY published_at DESC, first_seen_at DESC')
      .all() as Array<Record<string, string | null>>;
    return rows.map((row) => this.mapPost(row));
  }

  recordClassification(postId: string, classification: ClassificationResult): void {
    this.db
      .prepare(
        `INSERT INTO classifications (
           post_id, level, score, reasons_json, matched_terms_json, classifier_version
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        postId,
        classification.level,
        classification.score,
        JSON.stringify(classification.reasons),
        JSON.stringify(classification.matchedTerms),
        classification.classifierVersion,
      );
  }

  getLatestClassification(postId: string): StoredClassification | undefined {
    const row = this.db
      .prepare(
        `SELECT post_id, level, score, reasons_json, matched_terms_json,
                classifier_version, created_at
         FROM classifications WHERE post_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(postId) as Record<string, string | number> | undefined;

    if (!row) return undefined;
    return {
      postId: String(row.post_id),
      level: String(row.level) as SignalLevel,
      score: Number(row.score),
      reasons: parseJson<string[]>(String(row.reasons_json)),
      matchedTerms: parseJson<string[]>(String(row.matched_terms_json)),
      classifierVersion: String(row.classifier_version),
      createdAt: String(row.created_at),
    };
  }

  insertSignalEvent(event: SignalEvent): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO signal_events (
           id, post_id, level, previous_level, is_escalation, detected_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id || randomUUID(),
        event.postId,
        event.level,
        event.previousLevel,
        event.isEscalation ? 1 : 0,
        event.detectedAt,
      );
    return Number(result.changes) === 1;
  }

  listSignalEvents(): SignalEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM signal_events ORDER BY detected_at DESC')
      .all() as Array<Record<string, string | number | null>>;

    return rows.flatMap((row) => {
      return [
        {
          id: String(row.id),
          postId: String(row.post_id),
          level: String(row.level) as Exclude<SignalLevel, 'irrelevant'>,
          previousLevel: row.previous_level
            ? (String(row.previous_level) as SignalLevel)
            : null,
          isEscalation: Boolean(row.is_escalation),
          detectedAt: String(row.detected_at),
        },
      ];
    });
  }

  getSignalEvent(id: string): SignalEvent | undefined {
    const row = this.db.prepare('SELECT * FROM signal_events WHERE id = ?').get(id) as
      | Record<string, string | number | null>
      | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      postId: String(row.post_id),
      level: String(row.level) as Exclude<SignalLevel, 'irrelevant'>,
      previousLevel: row.previous_level ? (String(row.previous_level) as SignalLevel) : null,
      isEscalation: Boolean(row.is_escalation),
      detectedAt: String(row.detected_at),
    };
  }

  setEncryptedSecret(key: string, encryptedValue: Uint8Array): void {
    this.db
      .prepare(
        `INSERT INTO encrypted_secrets (key, value_base64, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value_base64 = excluded.value_base64,
           updated_at = excluded.updated_at`,
      )
      .run(key, Buffer.from(encryptedValue).toString('base64'));
  }

  getEncryptedSecret(key: string): Buffer | null {
    const row = this.db
      .prepare('SELECT value_base64 FROM encrypted_secrets WHERE key = ?')
      .get(key) as { value_base64: string } | undefined;
    return row ? Buffer.from(row.value_base64, 'base64') : null;
  }

  enqueueMail(eventId: string, attempt: number, nextAttemptAt: string): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO mail_queue (id, event_id, attempt, next_attempt_at, status)
         VALUES (?, ?, ?, ?, 'pending')`,
      )
      .run(id, eventId, attempt, nextAttemptAt);
    return id;
  }

  listDueMail(now: string): MailQueueItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM mail_queue
         WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY next_attempt_at ASC`,
      )
      .all(now) as Array<Record<string, string | number | null>>;
    return rows.map(mapMailQueueItem);
  }

  listMailQueue(): MailQueueItem[] {
    const rows = this.db
      .prepare('SELECT * FROM mail_queue ORDER BY created_at DESC')
      .all() as Array<Record<string, string | number | null>>;
    return rows.map(mapMailQueueItem);
  }

  recordSourceObservation(result: SourceCheckResult): void {
    this.db
      .prepare(
        `INSERT INTO source_observations (
          source_id, status, message, item_count, checked_at, latency_ms
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        result.sourceId,
        result.state,
        result.errorCode,
        result.posts.length,
        result.checkedAt,
        result.latencyMs,
      );
  }

  recordDelivery(eventId: string, receipt: DeliveryReceipt): void {
    this.db
      .prepare(
        `INSERT INTO deliveries (event_id, channel_id, status, detail, delivered_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(event_id, channel_id) DO UPDATE SET
           status = excluded.status,
           detail = excluded.detail,
           delivered_at = excluded.delivered_at`,
      )
      .run(eventId, receipt.channel, receipt.state, receipt.errorCode, receipt.deliveredAt);
  }

  rescheduleMail(id: string, attempt: number, nextAttemptAt: string, error: string): void {
    this.db
      .prepare(
        `UPDATE mail_queue SET attempt = ?, next_attempt_at = ?, last_error = ?, status = 'pending'
         WHERE id = ?`,
      )
      .run(attempt, nextAttemptAt, error, id);
  }

  markMailSent(id: string): void {
    this.db.prepare("UPDATE mail_queue SET status = 'sent', last_error = NULL WHERE id = ?").run(id);
  }

  markMailFinal(id: string): void {
    this.db.prepare("UPDATE mail_queue SET status = 'failed' WHERE id = ?").run(id);
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        author_handle TEXT NOT NULL,
        text TEXT NOT NULL,
        quoted_text TEXT,
        published_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        url TEXT NOT NULL,
        source_ids_json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS classifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        level TEXT NOT NULL,
        score INTEGER NOT NULL,
        reasons_json TEXT NOT NULL,
        matched_terms_json TEXT NOT NULL,
        classifier_version TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS signal_events (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        level TEXT NOT NULL,
        previous_level TEXT,
        is_escalation INTEGER NOT NULL,
        detected_at TEXT NOT NULL,
        UNIQUE(post_id, level)
      );
      CREATE TABLE IF NOT EXISTS source_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        item_count INTEGER NOT NULL DEFAULT 0,
        checked_at TEXT NOT NULL,
        latency_ms INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL REFERENCES signal_events(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT,
        delivered_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(event_id, channel_id)
      );
      CREATE TABLE IF NOT EXISTS mail_queue (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES signal_events(id) ON DELETE CASCADE,
        attempt INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        last_error TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS encrypted_secrets (
        key TEXT PRIMARY KEY,
        value_base64 TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      PRAGMA user_version = 1;
    `);

    const row = this.db.prepare('SELECT id FROM app_settings WHERE id = 1').get();
    if (!row) {
      this.db
        .prepare('INSERT INTO app_settings (id, value_json) VALUES (1, ?)')
        .run(JSON.stringify(DEFAULT_SETTINGS));
    }
  }

  private mapPost(row: Record<string, string | null>): MonitoredPost {
    return {
      id: String(row.id),
      authorHandle: String(row.author_handle),
      text: String(row.text),
      quotedText: row.quoted_text ?? null,
      createdAt: String(row.published_at),
      kind: String(row.kind) as MonitoredPost['kind'],
      url: String(row.url),
      sourceIds: parseJson<string[]>(String(row.source_ids_json)),
    };
  }
}

function mapMailQueueItem(row: Record<string, string | number | null>): MailQueueItem {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    attempt: Number(row.attempt),
    nextAttemptAt: String(row.next_attempt_at),
    lastError: row.last_error === null ? null : String(row.last_error),
    status: String(row.status) as MailQueueItem['status'],
  };
}
