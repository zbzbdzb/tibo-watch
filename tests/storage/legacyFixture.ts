import { DatabaseSync } from 'node:sqlite';

/** Complete released v1/v2 schema: no production data or credentials. */
export function createLegacyFixture(path: string, version: 1 | 2): void {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE app_settings(id INTEGER PRIMARY KEY CHECK(id = 1), value_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE posts(id TEXT PRIMARY KEY, author_handle TEXT NOT NULL, text TEXT NOT NULL, quoted_text TEXT, published_at TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL, source_ids_json TEXT NOT NULL, first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE classifications(id INTEGER PRIMARY KEY AUTOINCREMENT, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, level TEXT NOT NULL, score INTEGER NOT NULL, reasons_json TEXT NOT NULL, matched_terms_json TEXT NOT NULL, classifier_version TEXT NOT NULL, ${version === 2 ? 'input_hash TEXT,' : ''} created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    ${version === 2 ? 'CREATE INDEX idx_classifications_post_id_id ON classifications(post_id, id DESC);' : ''}
    CREATE TABLE signal_events(id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, level TEXT NOT NULL, previous_level TEXT, is_escalation INTEGER NOT NULL, detected_at TEXT NOT NULL, UNIQUE(post_id,level));
    CREATE TABLE source_observations(id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, status TEXT NOT NULL, message TEXT, item_count INTEGER NOT NULL DEFAULT 0, checked_at TEXT NOT NULL, latency_ms INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE deliveries(id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL REFERENCES signal_events(id) ON DELETE CASCADE, channel_id TEXT NOT NULL, status TEXT NOT NULL, detail TEXT, delivered_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(event_id,channel_id));
    CREATE TABLE mail_queue(id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES signal_events(id) ON DELETE CASCADE, attempt INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, last_error TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE encrypted_secrets(key TEXT PRIMARY KEY, value_base64 TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    PRAGMA user_version = ${version};
  `);
  db.prepare('INSERT INTO app_settings(id, value_json) VALUES(1, ?)').run(JSON.stringify({ baselineComplete: true, onboardingComplete: true, pollIntervalMinutes: 17, emailEnabled: true, emailRecipients: ['a@example.com', 'b@example.com'], smtpHost: 'fixture.invalid', smtpUsername: 'dummy@example.com', smtpFrom: 'dummy@example.com' }));
  db.prepare('INSERT INTO encrypted_secrets(key,value_base64) VALUES(?,?)').run('smtp-password', Buffer.from([7,19,42,255]).toString('base64'));
  for (const [id, numeric, kind, quote] of [['rss-guid', '42', 'quote', 'Long retained quote evidence'], ['42', '42', 'original', null], ['pending-only', '43', 'reply', null], ['failed-only', '44', 'original', null]] as const) {
    db.prepare('INSERT INTO posts(id,author_handle,text,quoted_text,published_at,kind,url,source_ids_json) VALUES(?,?,?,?,?,?,?,?)').run(id, 'thsottiaux', id === 'rss-guid' ? 'Codex usage reset now with all complete evidence' : 'Codex reset now', quote, '2026-09-05T09:00:00.000Z', kind, `https://x.com/thsottiaux/status/${numeric}`, JSON.stringify([id === 'rss-guid' ? 'public-rss' : 'x-browser']));
    db.prepare('INSERT INTO classifications(post_id,level,score,reasons_json,matched_terms_json,classifier_version) VALUES(?,?,?,?,?,?)').run(id, 'confirmed', 10, JSON.stringify([`reason-${id}`]), '["reset"]', 'legacy-rules');
    db.prepare('INSERT INTO signal_events(id,post_id,level,previous_level,is_escalation,detected_at) VALUES(?,?,?,?,?,?)').run(`event-${id}`, id, 'confirmed', null, 0, '2026-09-05T10:00:00.000Z');
  }
  db.prepare('INSERT INTO source_observations(source_id,status,message,item_count,checked_at,latency_ms) VALUES(?,?,?,?,?,?)').run('public-rss', 'online', 'historical observation', 4, '2026-09-05T10:00:00.000Z', 12);
  db.prepare('INSERT INTO deliveries(event_id,channel_id,status,detail,delivered_at) VALUES(?,?,?,?,?)').run('event-42', 'email', 'sent', null, '2026-09-05T10:00:00.000Z');
  db.prepare('INSERT INTO deliveries(event_id,channel_id,status,detail,delivered_at) VALUES(?,?,?,?,?)').run('event-rss-guid', 'email', 'queued', 'ECONNREFUSED', null);
  db.prepare('INSERT INTO deliveries(event_id,channel_id,status,detail,delivered_at) VALUES(?,?,?,?,?)').run('event-failed-only', 'email', 'failed', 'EAUTH', null);
  for (const [id, event, state] of [['q-duplicate', 'event-rss-guid', 'pending'], ['q-sent', 'event-42', 'sent'], ['q-pending', 'event-pending-only', 'pending'], ['q-failed', 'event-failed-only', 'failed']] as const) db.prepare('INSERT INTO mail_queue(id,event_id,attempt,next_attempt_at,last_error,status) VALUES(?,?,?,?,?,?)').run(id,event,1,'2026-09-05T10:01:00.000Z',state === 'sent' ? null : 'ECONNREFUSED',state);
  db.close();
}
