import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalPostId, mergeCanonicalPost } from './canonicalPost';

import type {
  ClassificationResult,
  MonitoredPost,
  SignalEvent,
  SignalLevel,
  SourceCheckResult,
  DeliveryReceipt,
  DeliveryStatusView,
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
  windowsConfirmedEnabled: boolean;
  windowsPreviewEnabled: boolean;
  windowsRelatedEnabled: boolean;
  windowsConfirmedSound: boolean;
  windowsPreviewSound: boolean;
  windowsRelatedSound: boolean;
}

export interface StoredClassification extends ClassificationResult {
  postId: string;
  inputHash: string | null;
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

export interface EventSnapshot { post: MonitoredPost; classification: ClassificationResult }
export interface DeliveryJob {
  id: string; eventId: string; channel: 'windows' | 'email'; recipient: string;
  state: DeliveryStatusView['state']; attempt: number; nextAttemptAt: string;
  lastError: string | null; createdAt: string; updatedAt: string; uncertain: boolean;
}
const activeSessions = new Set<string>();

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
  windowsConfirmedEnabled: true,
  windowsPreviewEnabled: true,
  windowsRelatedEnabled: true,
  windowsConfirmedSound: true,
  windowsPreviewSound: true,
  windowsRelatedSound: false,
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
  private readonly sessionId = randomUUID();

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    try {
      this.migrate();
      this.recoverInterruptedJobs();
      activeSessions.add(this.sessionId);
    } catch (error) { this.db.close(); throw error; }
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
    const originalId = post.id;
    const canonicalId = canonicalPostId(post);
    const existing = this.getPost(canonicalId);
    post = mergeCanonicalPost({ ...post, id: canonicalId }, existing ?? post);

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
        post.quotedText,
        post.createdAt,
        post.kind,
        post.url,
        JSON.stringify(post.sourceIds),
      );
    if (originalId !== post.id) this.db.prepare('INSERT OR REPLACE INTO post_aliases(alias_id, post_id) VALUES (?, ?)').run(originalId, post.id);
  }

  getPost(id: string): MonitoredPost | undefined {
    const row = this.db.prepare('SELECT * FROM posts WHERE id = ?').get(this.resolvePostId(id)) as
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

  recordClassification(
    postId: string,
    classification: ClassificationResult,
    inputHash: string | null = null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO classifications (
           post_id, level, score, reasons_json, matched_terms_json, classifier_version, input_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.resolvePostId(postId),
        classification.level,
        classification.score,
        JSON.stringify(classification.reasons),
        JSON.stringify(classification.matchedTerms),
        classification.classifierVersion,
        inputHash,
      );
  }

  getLatestClassification(postId: string): StoredClassification | undefined {
    const row = this.db
      .prepare(
        `SELECT post_id, level, score, reasons_json, matched_terms_json,
                classifier_version, input_hash, created_at
         FROM classifications WHERE post_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(this.resolvePostId(postId)) as Record<string, string | number | null> | undefined;

    if (!row) return undefined;
    return {
      postId: String(row.post_id),
      level: String(row.level) as SignalLevel,
      score: Number(row.score),
      reasons: parseJson<string[]>(String(row.reasons_json)),
      matchedTerms: parseJson<string[]>(String(row.matched_terms_json)),
      classifierVersion: String(row.classifier_version),
      inputHash: row.input_hash === null ? null : String(row.input_hash),
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
        this.resolvePostId(event.postId),
        event.level,
        event.previousLevel,
        event.isEscalation ? 1 : 0,
        event.detectedAt,
      );
    const inserted = Number(result.changes) === 1;
    if (inserted) this.storeEventSnapshot(event);
    return inserted;
  }

  listSignalEvents(): SignalEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM signal_events WHERE superseded_by IS NULL ORDER BY detected_at DESC')
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

  /** Classification, deduplication key, immutable evidence and delivery intent commit together. */
  recordClassificationAndSignal(postId: string, classification: ClassificationResult, inputHash: string, event: SignalEvent | null): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.recordClassification(postId, classification, inputHash);
      const inserted = event ? this.insertSignalEvent(event) : false;
      if (event && inserted) this.stageDeliveryJobs(event);
      this.db.exec('COMMIT');
      return inserted;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  getEventSnapshot(eventId: string): EventSnapshot | undefined {
    const row = this.db.prepare('SELECT snapshot_json FROM event_snapshots WHERE event_id = ?').get(eventId) as { snapshot_json: string } | undefined;
    return row ? parseJson<EventSnapshot>(row.snapshot_json) : undefined;
  }

  listDueDeliveryJobs(now: string): DeliveryJob[] {
    return (this.db.prepare("SELECT * FROM delivery_jobs WHERE state = 'pending' AND next_attempt_at <= ? ORDER BY created_at, channel DESC, recipient").all(now) as Array<Record<string, string | number | null>>).map(mapDeliveryJob);
  }

  claimDeliveryJob(id: string, now: string): boolean {
    return Number(this.db.prepare("UPDATE delivery_jobs SET state = 'sending', owner_token = ?, owner_pid = ?, updated_at = ? WHERE id = ? AND state = 'pending' AND next_attempt_at <= ?").run(this.sessionId, process.pid, now, id, now).changes) === 1;
  }

  finishDeliveryJob(id: string, state: DeliveryJob['state'], now: string, error: string | null = null, nextAttemptAt: string | null = null): void {
    const result = this.db.prepare("UPDATE delivery_jobs SET state = ?, attempt = attempt + 1, updated_at = ?, last_error = ?, next_attempt_at = COALESCE(?, next_attempt_at), owner_token = NULL, owner_pid = NULL WHERE id = ? AND owner_token = ?")
      .run(state, now, error, nextAttemptAt, id, this.sessionId);
    if (!Number(result.changes)) return;
    const row = this.db.prepare('SELECT legacy_queue_id FROM delivery_jobs WHERE id = ?').get(id) as { legacy_queue_id: string | null };
    if (row.legacy_queue_id) this.syncLegacyQueue(row.legacy_queue_id);
  }

  retryFailedDeliveryJobs(now: string, eventId?: string): void {
    this.db.prepare("UPDATE delivery_jobs SET state = 'pending', attempt = 0, next_attempt_at = ?, updated_at = ? WHERE state = 'failed' AND (? IS NULL OR event_id = ?)").run(now, now, eventId ?? null, eventId ?? null);
  }

  deliveryInvalidReason(job: DeliveryJob, now: string): string | null {
    const row = this.db.prepare('SELECT superseded_by FROM signal_events WHERE id = ?').get(job.eventId) as { superseded_by: string | null } | undefined;
    if (!row || row.superseded_by) return 'EVENT_SUPERSEDED';
    const event = this.getSignalEvent(job.eventId);
    if (!event) return 'EVENT_MISSING';
    const snapshot = this.getEventSnapshot(job.eventId);
    const current = this.getLatestClassification(event.postId);
    if (!snapshot || !current) return 'EVIDENCE_MISSING';
    if (current.level !== event.level) return current.level === 'confirmed' ? 'EVENT_SUPERSEDED' : 'CLASSIFICATION_DOWNGRADED';
    if (!freshAlertEligible(event.level, snapshot.post.createdAt, now)) return 'EVENT_EXPIRED';
    if (job.channel === 'windows' && !windowsNotificationPreferences(this.getSettings(), event.level).enabled) return 'WINDOWS_NOTIFICATION_DISABLED';
    if (job.channel === 'email') {
      const settings = this.getSettings();
      if (!settings.emailEnabled) return 'EMAIL_DISABLED';
      if (!normalizeRecipients(settings.emailRecipients).includes(job.recipient)) return 'RECIPIENT_REMOVED';
    }
    return null;
  }

  listDeliveryStatuses(): DeliveryStatusView[] {
    const rows = this.db.prepare('SELECT j.*, e.post_id FROM delivery_jobs j JOIN signal_events e ON e.id = j.event_id ORDER BY j.created_at DESC, j.id').all() as Array<Record<string, string | number | null>>;
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.event_id}:${row.channel}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const views: DeliveryStatusView[] = [];
    for (const group of groups.values()) {
      const first = group[0]!;
      const states = group.map((row) => String(row.state));
      const accepted = states.filter((state) => state === 'submitted').length;
      const pending = states.filter((state) => state === 'pending' || state === 'sending').length;
      const failed = states.filter((state) => state === 'failed').length;
      const state: DeliveryStatusView['state'] = states.includes('sending') ? 'sending'
        : accepted && (pending || failed) ? 'partial'
          : pending ? 'pending' : failed ? 'failed' : accepted ? 'submitted'
            : states.includes('cancelled') ? 'cancelled' : 'not-sent';
      views.push({ eventId: String(first.event_id), postId: String(first.post_id), channel: String(first.channel) as DeliveryJob['channel'], state,
        acceptedRecipientCount: first.channel === 'email' ? accepted : 0,
        failedRecipientCount: first.channel === 'email' ? failed : 0,
        pendingRecipientCount: first.channel === 'email' ? pending : 0,
        lastError: group.find((row) => row.last_error)?.last_error as string | undefined ?? null,
        createdAt: group.map((row) => String(row.created_at)).sort()[0]!,
        updatedAt: group.map((row) => String(row.updated_at)).sort().at(-1)!,
        nextAttemptAt: group.filter((row) => row.state === 'pending').map((row) => String(row.next_attempt_at)).sort()[0] ?? null,
        uncertain: group.some((row) => Boolean(row.uncertain)),
      });
    }
    // Legacy receipts remain visible, but are never converted into new delivery work.
    const historical = this.db.prepare('SELECT d.*, e.post_id FROM deliveries d JOIN signal_events e ON e.id = d.event_id WHERE NOT EXISTS (SELECT 1 FROM delivery_jobs j WHERE j.event_id = d.event_id AND j.channel = d.channel_id)').all() as Array<Record<string, string | number | null>>;
    for (const row of historical) views.push({ eventId: String(row.event_id), postId: String(row.post_id), channel: String(row.channel_id) as DeliveryJob['channel'], state: row.status === 'sent' ? 'submitted' : row.status === 'failed' ? 'failed' : 'not-sent', acceptedRecipientCount: 0, failedRecipientCount: 0, pendingRecipientCount: 0, lastError: row.detail as string | null, createdAt: String(row.created_at), updatedAt: String(row.delivered_at ?? row.created_at), nextAttemptAt: null, uncertain: row.channel_id === 'email' });
    return views;
  }

  private resolvePostId(id: string): string {
    const row = this.db.prepare('SELECT post_id FROM post_aliases WHERE alias_id = ?').get(id) as { post_id: string } | undefined;
    return row?.post_id ?? id;
  }

  private storeEventSnapshot(event: SignalEvent): void {
    const post = this.getPost(event.postId);
    let classification = this.getLatestClassification(event.postId);
    if (classification && classification.level !== event.level) {
      const row = this.db.prepare('SELECT * FROM classifications WHERE post_id = ? AND level = ? ORDER BY id DESC LIMIT 1').get(this.resolvePostId(event.postId), event.level) as Record<string, string | number | null> | undefined;
      classification = row ? { postId: String(row.post_id), level: event.level, score: Number(row.score), reasons: parseJson<string[]>(String(row.reasons_json)), matchedTerms: parseJson<string[]>(String(row.matched_terms_json)), classifierVersion: String(row.classifier_version), inputHash: row.input_hash as string | null, createdAt: String(row.created_at) } : undefined;
    }
    if (post && classification) this.db.prepare('INSERT OR IGNORE INTO event_snapshots(event_id, snapshot_json) VALUES (?, ?)').run(event.id, JSON.stringify({ post, classification }));
  }

  private stageDeliveryJobs(event: SignalEvent, legacy?: MailQueueItem): void {
    const settings = this.getSettings();
    const insert = this.db.prepare('INSERT OR IGNORE INTO delivery_jobs(id, event_id, channel, recipient, state, attempt, next_attempt_at, last_error, created_at, updated_at, legacy_queue_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    if (!legacy) {
      const windowsEnabled = windowsNotificationPreferences(settings, event.level).enabled;
      insert.run(randomUUID(), event.id, 'windows', '', windowsEnabled ? 'pending' : 'not-sent', 0, event.detectedAt, windowsEnabled ? null : 'WINDOWS_NOTIFICATION_DISABLED', event.detectedAt, event.detectedAt, null);
    }
    const recipients = settings.emailEnabled && event.level !== 'related' ? normalizeRecipients(settings.emailRecipients) : [];
    for (const recipient of recipients) insert.run(randomUUID(), event.id, 'email', recipient, 'pending', legacy?.attempt ?? 0, legacy?.nextAttemptAt ?? event.detectedAt, legacy?.lastError ?? null, event.detectedAt, event.detectedAt, legacy?.id ?? null);
    if (!recipients.length) insert.run(randomUUID(), event.id, 'email', '', 'not-sent', 0, event.detectedAt, event.level === 'related' ? 'RELATED_WINDOWS_ONLY' : 'EMAIL_NOT_CONFIGURED', event.detectedAt, event.detectedAt, legacy?.id ?? null);
  }

  private syncLegacyQueue(queueId: string): void {
    const rows = this.db.prepare('SELECT state, attempt, next_attempt_at, last_error FROM delivery_jobs WHERE legacy_queue_id = ?').all(queueId) as Array<Record<string, string | number | null>>;
    if (rows.some((row) => row.state === 'pending' || row.state === 'sending')) return;
    if (rows.every((row) => row.state === 'submitted')) this.markMailSent(queueId);
    else this.markMailFinal(queueId);
  }

  private recoverInterruptedJobs(): void {
    const rows = this.db.prepare("SELECT id, owner_token, owner_pid FROM delivery_jobs WHERE state = 'sending'").all() as Array<{ id: string; owner_token: string; owner_pid: number }>;
    for (const row of rows) {
      if (activeSessions.has(row.owner_token)) continue;
      if (row.owner_pid && row.owner_pid !== process.pid) {
        try { process.kill(row.owner_pid, 0); continue; } catch { /* Owner exited. */ }
      }
      this.db.prepare("UPDATE delivery_jobs SET state = 'pending', uncertain = 1, last_error = 'INTERRUPTED_DELIVERY_UNCERTAIN', owner_token = NULL, owner_pid = NULL WHERE id = ?").run(row.id);
    }
  }

  close(): void {
    activeSessions.delete(this.sessionId);
    this.db.close();
  }

  private migrate(): void {
    this.db.exec('PRAGMA foreign_keys = ON');
    const version = this.schemaVersion();
    if (version > 3) throw new Error(`Unsupported database schema version: ${version}`);
    if (version === 3) return;

    this.db.exec('PRAGMA foreign_keys = OFF');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (version === 0) this.createSchemaV2();
      if (version === 1) this.migrateV1ToV2();
      this.createSchemaV2();

      const row = this.db.prepare('SELECT id FROM app_settings WHERE id = 1').get();
      if (!row) {
        this.db
          .prepare('INSERT INTO app_settings (id, value_json) VALUES (1, ?)')
          .run(JSON.stringify(DEFAULT_SETTINGS));
      }
      this.migrateV2ToV3();
      this.db.exec('PRAGMA user_version = 3');
      const violations = this.db.prepare('PRAGMA foreign_key_check').all();
      if (violations.length) throw new Error('Migration failed foreign-key validation');
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON');
    }
  }

  private createSchemaV2(): void {
    this.db.exec(`
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
        input_hash TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_classifications_post_id_id
        ON classifications(post_id, id DESC);
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
    `);
  }

  private migrateV1ToV2(): void {
    this.db.exec(`
      ALTER TABLE classifications ADD COLUMN input_hash TEXT;
      CREATE INDEX idx_classifications_post_id_id
        ON classifications(post_id, id DESC);
    `);
  }

  private migrateV2ToV3(): void {
    this.db.exec(`
      CREATE TABLE post_aliases(alias_id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id));
      CREATE TABLE post_alias_history(alias_id TEXT PRIMARY KEY, original_row_json TEXT NOT NULL);
      CREATE TABLE signal_events_v3 (
        id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        level TEXT NOT NULL, previous_level TEXT, is_escalation INTEGER NOT NULL,
        detected_at TEXT NOT NULL, superseded_by TEXT REFERENCES signal_events(id)
      );
      INSERT INTO signal_events_v3(id, post_id, level, previous_level, is_escalation, detected_at)
        SELECT id, post_id, level, previous_level, is_escalation, detected_at FROM signal_events;
      DROP TABLE signal_events;
      ALTER TABLE signal_events_v3 RENAME TO signal_events;
      CREATE TABLE event_snapshots(event_id TEXT PRIMARY KEY REFERENCES signal_events(id), snapshot_json TEXT NOT NULL);
      CREATE TABLE delivery_jobs(
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES signal_events(id),
        channel TEXT NOT NULL, recipient TEXT NOT NULL, state TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
        last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        uncertain INTEGER NOT NULL DEFAULT 0, owner_token TEXT, owner_pid INTEGER,
        legacy_queue_id TEXT REFERENCES mail_queue(id), UNIQUE(event_id, channel, recipient)
      );
      CREATE INDEX idx_delivery_jobs_due ON delivery_jobs(state, next_attempt_at);
    `);
    for (const event of this.listSignalEvents()) this.storeEventSnapshot(event);
    // Keep every historical row/event/receipt. Only post aliases are consolidated;
    // original post rows remain losslessly archived for forensic inspection.
    const originalPosts = this.db.prepare('SELECT * FROM posts').all() as Array<Record<string, string | null>>;
    for (const row of originalPosts) this.db.prepare('INSERT OR IGNORE INTO post_alias_history VALUES (?, ?)').run(String(row.id), JSON.stringify(row));
    for (const post of originalPosts.map((row) => this.mapPost(row))) {
      const canonicalId = canonicalPostId(post);
      if (canonicalId === post.id) { this.upsertPost(post); continue; }
      this.upsertPost(post);
      this.db.prepare('UPDATE classifications SET post_id = ? WHERE post_id = ?').run(canonicalId, post.id);
      this.db.prepare('UPDATE signal_events SET post_id = ? WHERE post_id = ?').run(canonicalId, post.id);
      this.db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
    }
    for (const post of this.listPosts()) {
      const originals = originalPosts.filter((row) => canonicalPostId(this.mapPost(row)) === post.id);
      this.db.prepare('UPDATE posts SET first_seen_at = ?, last_seen_at = ? WHERE id = ?').run(
        originals.map((row) => String(row.first_seen_at)).sort()[0]!,
        originals.map((row) => String(row.last_seen_at)).sort().at(-1)!, post.id,
      );
    }
    const collisions = this.db.prepare('SELECT post_id, level FROM signal_events GROUP BY post_id, level HAVING COUNT(*) > 1').all() as Array<{ post_id: string; level: string }>;
    for (const collision of collisions) {
      const events = this.db.prepare(`SELECT e.id FROM signal_events e WHERE post_id = ? AND level = ?
        ORDER BY EXISTS(SELECT 1 FROM deliveries d WHERE d.event_id = e.id AND d.status = 'sent') DESC,
          EXISTS(SELECT 1 FROM mail_queue q WHERE q.event_id = e.id AND q.status = 'sent') DESC,
          e.detected_at, e.id`).all(collision.post_id, collision.level) as Array<{ id: string }>;
      for (const duplicate of events.slice(1)) this.db.prepare('UPDATE signal_events SET superseded_by = ? WHERE id = ?').run(events[0]!.id, duplicate.id);
    }
    this.db.exec('CREATE UNIQUE INDEX idx_signal_events_active_level ON signal_events(post_id, level) WHERE superseded_by IS NULL');
    // Historical sent/failed events are deliberately not replayed. Only old pending mail is imported.
    const pending = this.listMailQueue().filter((item) => item.status === 'pending');
    for (const item of pending) {
      const original = this.getSignalEvent(item.eventId);
      if (!original) continue;
      const winner = this.db.prepare('SELECT id FROM signal_events WHERE post_id = ? AND level = ? AND superseded_by IS NULL').get(original.postId, original.level) as { id: string };
      const alreadySent = this.db.prepare(`SELECT 1 FROM signal_events e WHERE e.post_id = ? AND e.level = ? AND
        (EXISTS(SELECT 1 FROM deliveries d WHERE d.event_id = e.id AND d.channel_id = 'email' AND d.status = 'sent')
        OR EXISTS(SELECT 1 FROM mail_queue q WHERE q.event_id = e.id AND q.status = 'sent')) LIMIT 1`).get(original.postId, original.level);
      if (alreadySent) continue;
      const event = this.getSignalEvent(winner.id)!;
      this.stageDeliveryJobs(event, item);
      this.db.prepare("UPDATE delivery_jobs SET uncertain = 1, last_error = 'LEGACY_RECIPIENT_OUTCOME_UNKNOWN' WHERE legacy_queue_id = ?").run(item.id);
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

export function freshAlertEligible(level: SignalEvent['level'], createdAt: string, now: string): boolean {
  const age = Date.parse(now) - Date.parse(createdAt);
  return Number.isFinite(age) && age >= -60_000 && Math.max(0, age) <= (level === 'confirmed' ? 12 : 36) * 3_600_000;
}

export function windowsNotificationPreferences(settings: AppSettings, level: SignalEvent['level']): { enabled: boolean; sound: boolean } {
  if (level === 'confirmed') return { enabled: settings.windowsConfirmedEnabled, sound: settings.windowsConfirmedSound };
  if (level === 'preview') return { enabled: settings.windowsPreviewEnabled, sound: settings.windowsPreviewSound };
  return { enabled: settings.windowsRelatedEnabled, sound: settings.windowsRelatedSound };
}

function mapDeliveryJob(row: Record<string, string | number | null>): DeliveryJob {
  return { id: String(row.id), eventId: String(row.event_id), channel: String(row.channel) as DeliveryJob['channel'], recipient: String(row.recipient), state: String(row.state) as DeliveryJob['state'], attempt: Number(row.attempt), nextAttemptAt: String(row.next_attempt_at), lastError: row.last_error as string | null, createdAt: String(row.created_at), updatedAt: String(row.updated_at), uncertain: Boolean(row.uncertain) };
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
