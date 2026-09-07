export type SignalLevel = 'confirmed' | 'preview' | 'related' | 'irrelevant';
export type PostKind = 'original' | 'reply' | 'quote';
export type SourceState = 'online' | 'syncing' | 'partial' | 'stale' | 'needs_login' | 'disabled' | 'error';

export interface MonitoredPost {
  id: string;
  authorHandle: string;
  text: string;
  createdAt: string;
  url: string;
  kind: PostKind;
  quotedText: string | null;
  sourceIds: string[];
}

export interface ClassificationResult {
  level: SignalLevel;
  score: number;
  reasons: string[];
  matchedTerms: string[];
  classifierVersion: string;
}

export interface ClassificationInput {
  post: MonitoredPost;
}

export interface CheckContext {
  checkedAt: string;
  signal: AbortSignal;
}

export interface SourceCheckResult {
  sourceId: string;
  checkedAt: string;
  state: SourceState;
  posts: MonitoredPost[];
  latencyMs: number;
  errorCode: string | null;
}

export interface PostSource {
  readonly id: string;
  check(context: CheckContext): Promise<SourceCheckResult>;
}

export interface Classifier {
  readonly id: string;
  classify(input: ClassificationInput): Promise<ClassificationResult>;
}

export interface SignalEvent {
  id: string;
  postId: string;
  level: Exclude<SignalLevel, 'irrelevant'>;
  previousLevel: SignalLevel | null;
  isEscalation: boolean;
  detectedAt: string;
}

export interface DeliveryReceipt {
  channel: 'windows' | 'email';
  state: 'sent' | 'failed' | 'queued' | 'partial';
  deliveredAt: string | null;
  errorCode: string | null;
  acceptedRecipients?: string[];
  rejectedRecipients?: string[];
}

export interface DeliveryStatusView {
  eventId: string;
  postId: string;
  channel: 'windows' | 'email';
  state: 'pending' | 'sending' | 'submitted' | 'partial' | 'failed' | 'cancelled' | 'not-sent';
  acceptedRecipientCount: number;
  failedRecipientCount: number;
  pendingRecipientCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string | null;
  uncertain: boolean;
}

export interface DeliveryChannel {
  readonly id: 'windows' | 'email';
  deliver(event: SignalEvent): Promise<DeliveryReceipt>;
}
