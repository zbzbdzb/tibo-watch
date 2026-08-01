import type { ClassificationResult, MonitoredPost, SignalEvent, SourceState } from './domain';

export interface RendererSettings {
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
  hasSmtpPassword: boolean;
}

export interface PostView {
  post: MonitoredPost;
  classification: ClassificationResult | null;
}

export interface SourceHealthView {
  sourceId: string;
  label: string;
  state: SourceState;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
}

export interface MailQueueView {
  id: string;
  eventId: string;
  attempt: number;
  nextAttemptAt: string;
  lastError: string | null;
  status: 'pending' | 'sent' | 'failed';
}

export interface AppSnapshot {
  settings: RendererSettings;
  posts: PostView[];
  events: SignalEvent[];
  sourceHealth: SourceHealthView[];
  mailQueue: MailQueueView[];
  paused: boolean;
  checking: boolean;
  xLoggedIn: boolean;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  version: string;
}

export interface SettingsUpdate extends Partial<Omit<RendererSettings, 'hasSmtpPassword'>> {
  smtpPassword?: string;
}

export interface TiboWatchApi {
  getSnapshot(): Promise<AppSnapshot>;
  updateSettings(update: SettingsUpdate): Promise<AppSnapshot>;
  checkNow(): Promise<AppSnapshot>;
  setPaused(paused: boolean): Promise<AppSnapshot>;
  openXLogin(): Promise<AppSnapshot>;
  logoutX(): Promise<AppSnapshot>;
  sendTestEmail(): Promise<{ ok: boolean; errorCode: string | null }>;
  openPost(url: string): Promise<void>;
  completeOnboarding(): Promise<AppSnapshot>;
  retryMail(id: string): Promise<AppSnapshot>;
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
  onSnapshot(listener: (snapshot: AppSnapshot) => void): () => void;
  onNavigatePost(listener: (postId: string) => void): () => void;
}
