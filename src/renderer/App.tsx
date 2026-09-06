import { useEffect, useState } from "react";
import {
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Clock3,
  Database,
  ExternalLink,
  Home,
  Info,
  LogOut,
  Mail,
  Menu,
  Minimize2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Save,
  Send,
  Settings,
  ShieldAlert,
  Square,
  Sun,
  X,
  Zap,
} from "lucide-react";

import type {
  AppSnapshot,
  PostView,
  RendererSettings,
  SettingsUpdate,
} from "../shared/api";
import type { SignalLevel } from "../shared/domain";
import { selectCurrentSignal } from "./currentSignal";
import { demoSnapshot, emptySnapshot } from "./demoData";
import { deliveryLabel, deliveryTone, latestDelivery } from "./deliveryStatus";

type Page = "overview" | "activity" | "sources" | "notifications" | "settings";
type Theme = "dark" | "light";

const THEME_STORAGE_KEY = "tibo-watch-theme";
const notificationRows = [
  { label: "确认重置", icon: CheckCircle2, enabled: "windowsConfirmedEnabled", sound: "windowsConfirmedSound" },
  { label: "预告", icon: Clock3, enabled: "windowsPreviewEnabled", sound: "windowsPreviewSound" },
  { label: "其他相关动态", icon: Info, enabled: "windowsRelatedEnabled", sound: "windowsRelatedSound" },
] as const;
type NotificationSetting = typeof notificationRows[number]["enabled" | "sound"];
function getInitialTheme(): Theme {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  return savedTheme === "light" || savedTheme === "dark" ? savedTheme : "dark";
}

const api = window.tiboWatch;

const navigation: Array<{ id: Page; label: string; icon: typeof Home }> = [
  { id: "overview", label: "总览", icon: Home },
  { id: "activity", label: "动态", icon: CircleGauge },
  { id: "sources", label: "数据源", icon: Database },
  { id: "notifications", label: "通知", icon: Bell },
  { id: "settings", label: "设置", icon: Settings },
];

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(
    api ? emptySnapshot : demoSnapshot,
  );
  const [page, setPage] = useState<Page>("overview");
  const [collapsed, setCollapsed] = useState(() => window.innerWidth <= 1180);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [focusedPostId, setFocusedPostId] = useState<string | null>(null);
  const [checkPending, setCheckPending] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    if (!api) return;
    void api.getSnapshot().then(setSnapshot).catch(() => setActionError("加载状态失败，请重新打开应用。"));
    return api.onSnapshot(setSnapshot);
  }, []);

  useEffect(
    () =>
      api?.onNavigatePost((postId) => {
        setFocusedPostId(postId);
        setPage("overview");
      }),
    [],
  );

  const checking = snapshot.checking || checkPending;
  const runCheck = async () => {
    if (checking) return;
    const startedAt = Date.now();
    setCheckPending(true);
    setActionError("");
    try {
      if (api) setSnapshot(await api.checkNow());
    } catch {
      setActionError("检查失败，请检查数据源连接后重试。");
    } finally {
      const remainingFeedbackMs = 650 - (Date.now() - startedAt);
      if (remainingFeedbackMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, remainingFeedbackMs),
        );
      }
      setCheckPending(false);
    }
  };
  const currentTitle =
    navigation.find((item) => item.id === page)?.label ?? "总览";

  return (
    <div
      className={`app ${collapsed ? "sidebar-collapsed" : ""}`}
      data-theme={theme}
    >
      <header className="titlebar">
        <button
          className="icon-button menu-button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label="切换导航"
        >
          <Menu />
        </button>
        <strong>Tibo Watch</strong>
        <span>Codex 重置监测</span>
        <div className="window-actions">
          <button
            onClick={() => void api?.windowAction("minimize")}
            aria-label="最小化"
          >
            <Minimize2 />
          </button>
          <button
            onClick={() => void api?.windowAction("maximize")}
            aria-label="最大化"
          >
            <Square />
          </button>
          <button
            onClick={() => void api?.windowAction("close")}
            aria-label="关闭"
          >
            <X />
          </button>
        </div>
      </header>
      <aside className="sidebar">
        <nav>
          {navigation.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? "active" : ""}
              onClick={() => setPage(item.id)}
              title={item.label}
            >
              <item.icon />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            onClick={() =>
              setTheme((value) => (value === "dark" ? "light" : "dark"))
            }
            aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
            title={theme === "dark" ? "浅色模式" : "深色模式"}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
            <span>{theme === "dark" ? "浅色模式" : "深色模式"}</span>
          </button>
          <button
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "展开导航" : "收起导航"}
            title={collapsed ? "展开" : "收起"}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            <span>{collapsed ? "展开" : "收起"}</span>
          </button>
        </div>
      </aside>
      <main
        className={`content ${page === "overview" ? "overview-content" : ""}`}
        aria-label={currentTitle}
      >
        {(actionError || snapshot.lastCheckError) && <p className="action-error" role="alert">{actionError || "检查未完成，请查看数据源和通知记录。"}</p>}
        {page === "overview" && (
          <Overview
            key={focusedPostId ?? "overview"}
            snapshot={snapshot}
            onCheck={runCheck}
            checking={checking}
            onShowSources={() => setPage("sources")}
            initialPostId={focusedPostId}
          />
        )}
        {page === "activity" && <Activity snapshot={snapshot} />}
        {page === "sources" && (
          <Sources snapshot={snapshot} onCheck={runCheck} checking={checking} />
        )}
        {page === "notifications" && (
          <Notifications snapshot={snapshot} onUpdated={setSnapshot} />
        )}
        {page === "settings" && (
          <SettingsPage
            snapshot={snapshot}
            onSaved={setSnapshot}
            onCheck={runCheck}
            checking={checking}
          />
        )}
      </main>
      <footer className="statusbar">
        <span>
          <i className="status-dot" />
          {snapshot.paused ? "监测已暂停" : !snapshot.settings.browserSourceEnabled && !snapshot.settings.publicRssEnabled ? "未启用数据源" : "后台监测中"} · 每{" "}
          {snapshot.settings.pollIntervalMinutes} 分钟检查
        </span>
        <span>
          版本 {snapshot.version} <CheckCircle2 />
        </span>
      </footer>
      {api && !snapshot.settings.onboardingComplete && (
        <Onboarding snapshot={snapshot} onDone={setSnapshot} />
      )}
    </div>
  );
}

function Overview({
  snapshot,
  onCheck,
  checking,
  onShowSources,
  initialPostId,
}: {
  snapshot: AppSnapshot;
  onCheck: () => Promise<void>;
  checking: boolean;
  onShowSources: () => void;
  initialPostId: string | null;
}) {
  const [referenceTime, setReferenceTime] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setReferenceTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [filter, setFilter] = useState<
    "all" | Exclude<SignalLevel, "irrelevant">
  >("all");
  const filtered = snapshot.posts.filter(
    (item) => filter === "all" || item.classification?.level === filter,
  );
  const [selectedId, setSelectedId] = useState(
    initialPostId ?? snapshot.posts[0]?.post.id ?? "",
  );
  const selected =
    snapshot.posts.find((item) => item.post.id === selectedId) ??
    snapshot.posts[0];
  const lastCheckedTime = Date.parse(snapshot.lastCheckedAt ?? "");
  const currentSignal = selectCurrentSignal(
    snapshot.posts,
    Number.isFinite(lastCheckedTime)
      ? Math.max(referenceTime, lastCheckedTime)
      : referenceTime,
  );
  const currentLevel = currentSignal?.classification?.level;
  const currentTitle =
    currentLevel === "confirmed"
      ? "已确认重置"
      : currentLevel === "preview"
        ? "重置预告"
        : "监测中";
  return (
    <div className="overview-layout">
      <section className="hero-panel">
        <div className="current-state">
          <h2>当前状态</h2>
          <div className={`signal-summary ${currentLevel ?? "idle"}`}>
            <div className="summary-icon">
              {currentLevel === "confirmed" ? (
                <Check />
              ) : currentLevel === "preview" ? (
                <Clock3 />
              ) : (
                <CircleGauge />
              )}
            </div>
            <div>
              <h1>{currentTitle}</h1>
              <p>
                {currentSignal?.post.text ?? "正在等待 Tibo 发布新的 Codex 重置动态。"}
              </p>
              <dl>
                <div>
                  <dt>
                    <Clock3 />
                    最近检查
                  </dt>
                  <dd>{time(snapshot.lastCheckedAt)}</dd>
                </div>
                <div>
                  <dt>
                    <Clock3 />
                    下次检查
                  </dt>
                  <dd>{time(snapshot.nextCheckAt)}</dd>
                </div>
              </dl>
              <button
                className="outline-button"
                disabled={!currentSignal}
                onClick={() => currentSignal && openPost(currentSignal.post.url)}
              >
                <ExternalLink />
                查看原帖
              </button>
            </div>
          </div>
        </div>
        <div className="runtime-state">
          <h2>运行状态</h2>
          <label>数据源</label>
          {snapshot.sourceHealth.map((source) => (
            <div className="health-row" key={source.sourceId}>
              {source.sourceId === "x-browser" ? <X /> : <Zap />}
              <span>{source.label}</span>
              <Status state={source.state} errorCode={source.errorCode ?? null} />
            </div>
          ))}
          <label>通知服务</label>
          <div className="health-row">
            <Square />
            <span>Windows 通知</span>
            <em className={!snapshot.windowsNotificationsSupported ? "status-error" : notificationRows.every(row => !snapshot.settings[row.enabled]) ? "status-disabled" : ""}>
              <i />
              {!snapshot.windowsNotificationsSupported ? "系统不支持" : notificationRows.every(row => !snapshot.settings[row.enabled]) ? "已停用" : notificationRows.every(row => snapshot.settings[row.enabled]) ? "已启用" : "部分启用"}
            </em>
          </div>
          <div className="health-row">
            <Mail />
            <span>邮件通知</span>
            <em
              className={
                snapshot.settings.emailEnabled ? deliveryTone(latestDelivery(snapshot.deliveries, "email")) : "status-disabled"
              }
            >
              <i />
              {snapshot.settings.emailEnabled ? (latestDelivery(snapshot.deliveries, "email") ? deliveryLabel(latestDelivery(snapshot.deliveries, "email")).split(" · ")[0] : "已启用·无记录") : "未启用"}
            </em>
          </div>
          <button className="link-button" onClick={onShowSources}>
            查看详细状态 <ChevronRight />
          </button>
        </div>
      </section>
      <section className="feed-panel">
        <div className="feed-list">
          <div className="tabs">
            {(
              [
                ["all", "全部"],
                ["confirmed", "确认"],
                ["preview", "预告"],
                ["related", "相关"],
              ] as const
            ).map(([id, label]) => (
              <button
                className={filter === id ? "active" : ""}
                onClick={() => setFilter(id)}
                key={id}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="feed-toolbar">
            <span>共 {snapshot.posts.length} 条记录</span>
            <button
              disabled={checking}
              aria-busy={checking}
              onClick={() => void onCheck()}
            >
              <RefreshCw className={checking ? "spin" : ""} />
              {checking ? "刷新中…" : "刷新"}
            </button>
          </div>
          <div className="timeline">
            {filtered.map((item) => (
              <TimelineRow
                key={item.post.id}
                item={item}
                selected={selected?.post.id === item.post.id}
                onClick={() => setSelectedId(item.post.id)}
              />
            ))}
          </div>
        </div>
        <div className="detail-pane">
          {selected ? (
            <PostDetail item={selected} snapshot={snapshot} />
          ) : (
            <Empty label="尚无动态记录" />
          )}
        </div>
      </section>
    </div>
  );
}

function TimelineRow({
  item,
  selected,
  onClick,
}: {
  item: PostView;
  selected: boolean;
  onClick: () => void;
}) {
  const level = item.classification?.level ?? "irrelevant";
  return (
    <button
      className={`timeline-row ${selected ? "selected" : ""} ${level}`}
      onClick={onClick}
    >
      <span className="timeline-marker">
        {level === "confirmed" ? (
          <Check />
        ) : level === "preview" ? (
          <Clock3 />
        ) : (
          <Info />
        )}
      </span>
      <time>
        {date(item.post.createdAt)}
        <strong>{time(item.post.createdAt)}</strong>
        <small>北京时间</small>
      </time>
      <span className="post-copy">
        <strong>{item.post.text}</strong>
        <small>Tibo · @thsottiaux</small>
      </span>
      <LevelLabel level={level} />
      <ChevronRight />
    </button>
  );
}

function PostDetail({ item, snapshot }: { item: PostView; snapshot: AppSnapshot }) {
  const level = item.classification?.level ?? "irrelevant";
  return (
    <div className="post-detail">
      <div className={`detail-heading ${level}`}>
        <LevelIcon level={level} />
        <strong>
          <LevelLabel level={level} />
        </strong>
        <time>{fullDate(item.post.createdAt)} 北京时间</time>
      </div>
      <h3>动态原文</h3>
      <p className="original-post">{item.post.text}</p>
      {item.post.quotedText && <><h3>引用上下文</h3><blockquote className="original-post">{item.post.quotedText}</blockquote></>}
      <h3>判定依据</h3>
      <p>{item.classification?.reasons.join("；") ?? "尚未分类。"}</p>
      <h3>判定证据</h3>
      <div className="term-list">
        {item.classification?.matchedTerms.map((term) => (
          <span key={term}>{term}</span>
        ))}
      </div>
      <h3>来源证据</h3>
      <button className="source-link" onClick={() => openPost(item.post.url)}>
        <X />
        {item.post.url}
        <ExternalLink />
      </button>
      <h3>邮件送达状态</h3>
      <p>
        <Mail />{" "}
        {deliveryLabel(latestDelivery(snapshot.deliveries, "email", item.post.id))}
      </p>
      <small>SMTP 接受不代表邮件已进入收件箱。{!snapshot.settings.emailEnabled && "邮件通知当前已关闭。"}</small>
      <button
        className="outline-button detail-open"
        onClick={() => openPost(item.post.url)}
      >
        查看原帖 <ExternalLink />
      </button>
    </div>
  );
}

function Activity({ snapshot }: { snapshot: AppSnapshot }) {
  return (
    <PageShell title="动态" subtitle="查看所有监测到的原创、回复与引用动态">
      <div className="simple-list">
        {snapshot.posts.map((item) => (
          <TimelineRow
            key={item.post.id}
            item={item}
            selected={false}
            onClick={() => openPost(item.post.url)}
          />
        ))}
      </div>
    </PageShell>
  );
}
function Sources({
  snapshot,
  onCheck,
  checking,
}: {
  snapshot: AppSnapshot;
  onCheck: () => Promise<void>;
  checking: boolean;
}) {
  return (
    <PageShell
      title="数据源"
      subtitle="检查 Chrome 登录共享和公共 RSS 的健康状态"
    >
      <div className="source-grid">
        {snapshot.sourceHealth.map((source) => (
          <section key={source.sourceId}>
            <h3>{source.label}</h3>
            <Status state={source.state} errorCode={source.errorCode ?? null} />
            <p>连续失败：{source.consecutiveFailures} 次</p>
            <p>最近成功：{fullDate(source.lastSuccessAt)}</p>
            {source.errorCode && <p className="action-error">诊断：{source.errorCode}</p>}
          </section>
        ))}
      </div>
      <button
        className="outline-button check-button"
        disabled={checking}
        aria-busy={checking}
        onClick={() => void onCheck()}
      >
        <RefreshCw className={checking ? "spin" : ""} />
        {checking ? "检查中…" : "立即检查全部"}
      </button>
    </PageShell>
  );
}
function Notifications({
  snapshot,
  onUpdated,
}: {
  snapshot: AppSnapshot;
  onUpdated: (value: AppSnapshot) => void;
}) {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryError, setRetryError] = useState("");
  const retry = async (eventId: string) => {
    if (!api || retrying) return;
    setRetrying(eventId);
    setRetryError("");
    try { onUpdated(await api.retryMail(eventId)); }
    catch { setRetryError("重试失败，请检查配置后重试。"); }
    finally { setRetrying(null); }
  };
  return (
    <PageShell title="通知" subtitle="查看信号事件与邮件重试状态">
      {retryError && <p role="alert" className="action-error">{retryError}</p>}
      <div className="notification-list">
        {snapshot.events.length ? (
          snapshot.events.map((event) => (
            <div key={event.id}>
              <LevelIcon level={event.level} />
              <span>
                <strong>{labelFor(event.level)}</strong>
                <small>
                  {fullDate(event.detectedAt)} ·{" "}
                  {event.isEscalation ? `由${labelFor(event.previousLevel ?? "related")}升级` : "首次识别"}
                </small>
              </span>
            </div>
          ))
        ) : (
          <Empty label="尚无通知记录" />
        )}
      </div>
      {snapshot.deliveries.length > 0 && (
        <section className="retry-list">
          <h2>通知送达记录</h2>
          <p>邮件按收件人记录提交结果；SMTP 接受不代表已进入收件箱。</p>
          {snapshot.deliveries.map((item) => (
            <div key={`${item.eventId}-${item.channel}`}>
              <span>
                <strong className={deliveryTone(item)}>{item.channel === "email" ? "邮件" : "Windows"}：{deliveryLabel(item)}</strong>
                <small>
                  {fullDate(item.updatedAt)}{item.nextAttemptAt ? ` · 下次重试：${fullDate(item.nextAttemptAt)}` : ""}{item.lastError ? ` · ${item.lastError}` : ""}
                </small>
              </span>
              {item.channel === "email" && item.failedRecipientCount > 0 && (item.state === "failed" || item.state === "partial") && (
                <button
                  className="outline-button"
                  disabled={retrying !== null}
                  onClick={() => void retry(item.eventId)}
                >
                  <RefreshCw className={retrying === item.eventId ? "spin" : ""} />
                  {retrying === item.eventId ? "重试中…" : "重试失败收件人"}
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </PageShell>
  );
}

function SettingsPage({
  snapshot,
  onSaved,
  onCheck,
  checking,
}: {
  snapshot: AppSnapshot;
  onSaved: (value: AppSnapshot) => void;
  onCheck: () => Promise<void>;
  checking: boolean;
}) {
  const [form, setForm] = useState<RendererSettings>(snapshot.settings);
  const [password, setPassword] = useState("");
  const [testState, setTestState] = useState("");
  const [saveState, setSaveState] = useState("");
  const [busy, setBusy] = useState(false);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [recipientsText, setRecipientsText] = useState(snapshot.settings.emailRecipients.join(", "));
  const update = <K extends keyof RendererSettings>(
    key: K,
    value: RendererSettings[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
  const persistNotification = async (key: NotificationSetting, value: boolean) => {
    if (notificationSaving || busy) return;
    const previous = form[key];
    setNotificationSaving(true);
    update(key, value);
    try {
      if (api) onSaved(await api.updateSettings({ [key]: value }));
      else onSaved({ ...snapshot, settings: { ...snapshot.settings, [key]: value } });
      setSaveState("Windows 通知设置已即时保存。");
    } catch {
      update(key, previous);
      setSaveState("通知设置保存失败，已恢复原值，请重试。");
    } finally { setNotificationSaving(false); }
  };
  const persistPublicRss = async (value: boolean) => {
    update("publicRssEnabled", value);
    try {
      if (api) onSaved(await api.updateSettings({ publicRssEnabled: value }));
      else onSaved({ ...snapshot, settings: { ...snapshot.settings, publicRssEnabled: value } });
      setSaveState("公共 RSS 开关已保存，其他修改请保存全部设置。");
    } catch {
      update("publicRssEnabled", snapshot.settings.publicRssEnabled);
      setSaveState("保存失败，请重试。");
    }
  };
  const persist = async () => {
    const payload: SettingsUpdate = {
      pollIntervalMinutes: form.pollIntervalMinutes,
      browserSourceEnabled: form.browserSourceEnabled,
      publicRssEnabled: form.publicRssEnabled,
      startAtLogin: form.startAtLogin,
      closeToTray: form.closeToTray,
      windowsConfirmedEnabled: form.windowsConfirmedEnabled,
      windowsPreviewEnabled: form.windowsPreviewEnabled,
      windowsRelatedEnabled: form.windowsRelatedEnabled,
      windowsConfirmedSound: form.windowsConfirmedSound,
      windowsPreviewSound: form.windowsPreviewSound,
      windowsRelatedSound: form.windowsRelatedSound,
      emailEnabled: form.emailEnabled,
      emailRecipients: [...new Set(recipientsText.split(/[\n,;，；]/).map((value) => value.trim()).filter(Boolean))],
      smtpHost: form.smtpHost,
      smtpPort: form.smtpPort,
      smtpSecure: form.smtpSecure,
      smtpUsername: form.smtpUsername,
      smtpFrom: form.smtpFrom,
      ...(password ? { smtpPassword: password } : {}),
    };
    const updated = api ? await api.updateSettings(payload) : { ...snapshot, settings: { ...form, ...payload, hasSmtpPassword: !!password || form.hasSmtpPassword } };
    onSaved(updated);
    setForm(updated.settings);
    setPassword("");
    setSaveState("全部设置已保存。");
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try { await persist(); }
    catch { setSaveState("保存失败：请检查邮箱地址、端口和检查间隔。"); }
    finally { setBusy(false); }
  };
  const test = async () => {
    if (busy) return;
    setBusy(true);
    setTestState("正在保存配置并发送测试邮件…");
    try {
      await persist();
      if (!api) { setTestState("演示模式：未实际发送邮件。"); return; }
      const result = await api.sendTestEmail();
      setTestState(result.ok ? "所有收件人已获 SMTP 接受，请检查收件箱。" : `发送未全部成功：${result.errorCode}`);
    } catch {
      setTestState("测试失败：请检查邮箱配置后重试。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <PageShell
      title="设置"
      subtitle="配置数据源、通知与后台运行"
      className="settings-page"
    >
      <div className="settings-columns">
        <div className="settings-column">
          <SettingsSection title="Chrome 登录共享">
            <div className="login-status">
              <span>
                <i className={`status-dot ${snapshot.xLoggedIn ? "" : "disconnected-dot"}`} />{" "}
                {snapshot.xLoggedIn
                  ? "已连接 · 正在使用 Chrome X 会话"
                  : "扩展未连接"}
              </span>
              <div>
                <button
                  className="outline-button"
                  onClick={async () => {
                    if (!api) return;
                    try { const updated = await api.openXLogin(); onSaved(updated); update("browserSourceEnabled", updated.settings.browserSourceEnabled); }
                    catch { setSaveState("打开扩展失败，请从 Chrome 扩展页检查安装。"); }
                  }}
                >
                  <RefreshCw />
                  安装/打开扩展
                </button>
                {snapshot.xLoggedIn && (
                  <button
                    className="neutral-button"
                    onClick={async () => {
                      if (!api) return;
                      try { const updated = await api.logoutX(); onSaved(updated); update("browserSourceEnabled", false); }
                      catch { setSaveState("断开失败，请重试。"); }
                    }}
                  >
                    <LogOut />
                    断开
                  </button>
                )}
              </div>
            </div>
            <Toggle
              checked={form.browserSourceEnabled}
              onChange={(value) => update("browserSourceEnabled", value)}
              label="启用 Chrome 登录共享"
            />
            <p className="warning">
              <ShieldAlert />
              扩展只读取 Chrome 页面中可见的公开动态，不会读取或复制
              Cookie、密码和会话令牌。首次使用需在 Chrome 扩展页加载一次。
            </p>
          </SettingsSection>
          <SettingsSection title="公共 RSS">
            <Toggle
              checked={form.publicRssEnabled}
              onChange={(value) => void persistPublicRss(value)}
              label="启用公共 RSS"
            />
            <p>使用公共实例注册表自动故障切换，并缓存最后可用实例。公共实例可用性不保证，以下为最近实际检查结果。</p>
            <div className="health-row"><span>公共 RSS 最近检查</span><Status state={snapshot.sourceHealth.find((source) => source.sourceId === "public-rss")?.state ?? "disabled"} /></div>
            <button className="outline-button" disabled={checking} aria-busy={checking} onClick={() => void onCheck()}>
              <RefreshCw className={checking ? "spin" : ""} />
              {checking ? "检查中…" : "检查数据源"}
            </button>
          </SettingsSection>
          <SettingsSection title="监测">
            <FormRow label="检查间隔">
              <select
                value={form.pollIntervalMinutes}
                onChange={(event) =>
                  update("pollIntervalMinutes", Number(event.target.value))
                }
              >
                <option value={5}>每 5 分钟</option>
                <option value={10}>每 10 分钟</option>
                <option value={15}>每 15 分钟</option>
              </select>
            </FormRow>
            <Toggle
              checked={form.startAtLogin}
              onChange={(value) => update("startAtLogin", value)}
              label="开机自启"
            />
            <Toggle
              checked={form.closeToTray}
              onChange={(value) => update("closeToTray", value)}
              label="关闭窗口时继续在托盘运行"
            />
          </SettingsSection>
        </div>
        <div className="settings-column">
          <SettingsSection title="Windows 通知">
            {notificationRows.map((row) => (
              <div className="sound-row" key={row.enabled}>
                <row.icon />
                <span>{row.label}</span>
                <Toggle checked={form[row.enabled]} label="" ariaLabel={`${row.label}通知`} disabled={busy || notificationSaving} onChange={(value) => void persistNotification(row.enabled, value)} />
                <select aria-label={`${row.label}声音`} value={form[row.sound] ? "sound" : "silent"} disabled={!form[row.enabled] || busy || notificationSaving} onChange={(event) => void persistNotification(row.sound, event.target.value === "sound")}>
                  <option value="sound">默认声音</option>
                  <option value="silent">静音（无声）</option>
                </select>
              </div>
            ))}
            <p className="notification-help">开关和声音修改后立即保存，不影响邮件通知。关闭的类别不再弹窗；重新开启不会补发旧提醒。</p>
          </SettingsSection>
          <SettingsSection title="邮件通知">
            <Toggle
              checked={form.emailEnabled}
              onChange={(value) => update("emailEnabled", value)}
              label="启用邮件通知"
            />
            <div className="smtp-grid">
              <FormRow label="SMTP 主机">
                <input
                  value={form.smtpHost}
                  onChange={(event) => update("smtpHost", event.target.value)}
                />
              </FormRow>
              <FormRow label="端口">
                <input
                  type="number"
                  value={form.smtpPort}
                  onChange={(event) =>
                    update("smtpPort", Number(event.target.value))
                  }
                />
              </FormRow>
            </div>
            <FormRow label="加密方式">
              <select
                value={form.smtpSecure ? "ssl" : "starttls"}
                onChange={(event) =>
                  update("smtpSecure", event.target.value === "ssl")
                }
              >
                <option value="starttls">STARTTLS</option>
                <option value="ssl">SSL / TLS</option>
              </select>
            </FormRow>
            <FormRow label="用户名">
              <input
                value={form.smtpUsername}
                onChange={(event) => update("smtpUsername", event.target.value)}
              />
            </FormRow>
            <FormRow label="应用密码">
              <input
                type="password"
                value={password}
                placeholder={
                  form.hasSmtpPassword
                    ? "已安全保存；留空则不修改"
                    : "请输入应用密码"
                }
                onChange={(event) => setPassword(event.target.value)}
              />
            </FormRow>
            <FormRow label="发件人名称">
              <input
                value={form.smtpFrom}
                onChange={(event) => update("smtpFrom", event.target.value)}
              />
            </FormRow>
            <FormRow label="收件人地址（多个用逗号或换行分隔）">
              <textarea
                value={recipientsText}
                onChange={(event) => setRecipientsText(event.target.value)}
              />
            </FormRow>
            <div className="save-row">
              <button className="outline-button" disabled={busy || notificationSaving} onClick={() => void test()}>
                <Send />
                发送测试邮件
              </button>
              {testState && <span role="status">{testState}</span>}
            </div>
          </SettingsSection>
        </div>
      </div>
      <div className="settings-save-bar">
        <span>
          <Save />
          {saveState || "保存监测、启动与邮件等全部配置"}
        </span>
        <button className="primary-button" disabled={busy || notificationSaving} onClick={() => void save()}>
          <Save />
          保存全部设置
        </button>
      </div>
    </PageShell>
  );
}

function Onboarding({
  snapshot,
  onDone,
}: {
  snapshot: AppSnapshot;
  onDone: (value: AppSnapshot) => void;
}) {
  return (
    <div className="onboarding-backdrop">
      <section className="onboarding">
        <div className="brand-mark">
          <Zap />
        </div>
        <h1>开始监测 Codex 重置</h1>
        <p>
          Tibo Watch 将每 5 分钟检查 @thsottiaux
          的动态，并在确认或预告重置时提醒你。
        </p>
        <ul>
          <li>
            <Check />
            公共 RSS 已默认启用
          </li>
          <li>
            <ShieldAlert />
            Chrome 登录共享可稍后在设置中启用
          </li>
          <li>
            <Mail />
            邮件密码由 Windows DPAPI 加密保存
          </li>
        </ul>
        <button
          className="primary-button"
          onClick={async () =>
            onDone(
              api
                ? await api.completeOnboarding()
                : {
                    ...snapshot,
                    settings: {
                      ...snapshot.settings,
                      onboardingComplete: true,
                      baselineComplete: true,
                    },
                  },
            )
          }
        >
          建立历史基线并开始
        </button>
      </section>
    </div>
  );
}
function PageShell({
  title,
  subtitle,
  className = "",
  children,
}: {
  title: string;
  subtitle: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`page-shell ${className}`}>
      <header>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </header>
      {children}
    </div>
  );
}
function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function FormRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="form-row">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Toggle({
  checked,
  onChange = () => {},
  label,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean;
  onChange?: (value: boolean) => void;
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <label className="toggle-row">
      <button
        type="button"
        role="switch"
        aria-label={ariaLabel}
        disabled={disabled}
        aria-checked={checked}
        className={`toggle ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <i />
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}
function Empty({ label }: { label: string }) {
  return (
    <div className="empty">
      <Info />
      <span>{label}</span>
    </div>
  );
}
function Status({ state, errorCode }: { state: string; errorCode?: string | null }) {
  const disabled = state === "disabled";
  return (
    <em
      className={
        state === "online" ? "" : disabled ? "status-disabled" : "status-error"
      }
    >
      <i />
      {errorCode === "X_COMPANION_WAITING" ? "等待扩展"
        : errorCode === "X_COMPANION_LEGACY_NEEDS_REFRESH" ? "需重载扩展"
        : state === "online"
        ? "在线"
        : state === "stale"
          ? "已过期"
          : state === "needs_login"
            ? "需登录"
            : disabled
              ? "已停用"
              : "异常"}
    </em>
  );
}
function LevelIcon({ level }: { level: SignalLevel }) {
  return level === "confirmed" ? (
    <CheckCircle2 />
  ) : level === "preview" ? (
    <Clock3 />
  ) : (
    <Info />
  );
}
function LevelLabel({ level }: { level: SignalLevel }) {
  return <span className={`level-label ${level}`}>{labelFor(level)}</span>;
}
function labelFor(level: SignalLevel) {
  return level === "confirmed"
    ? "已确认重置"
    : level === "preview"
      ? "预告"
      : level === "related"
        ? "相关"
        : "无关";
}

function time(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "—";
}
function date(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(value))
    .replaceAll("/", "-");
}
function fullDate(value: string | null) {
  return value ? `${date(value)} ${time(value)}` : "—";
}
function openPost(url: string) {
  if (api) void api.openPost(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
