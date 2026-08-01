import { useEffect, useState } from 'react';
import {
  Bell, Check, CheckCircle2, ChevronRight, CircleGauge, Clock3, Database,
  ExternalLink, Home, Info, LogOut, Mail, Menu, Minimize2, Moon, PanelLeftClose,
  PanelLeftOpen, RefreshCw, Save, Send, Settings, ShieldAlert, Square, Sun, X, Zap,
} from 'lucide-react';

import type { AppSnapshot, PostView, RendererSettings, SettingsUpdate } from '../shared/api';
import type { SignalLevel } from '../shared/domain';
import { demoSnapshot, emptySnapshot } from './demoData';

type Page = 'overview' | 'activity' | 'sources' | 'notifications' | 'settings';
type Theme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'tibo-watch-theme';

function getInitialTheme(): Theme {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  return savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'dark';
}

const api = window.tiboWatch;

const navigation: Array<{ id: Page; label: string; icon: typeof Home }> = [
  { id: 'overview', label: '总览', icon: Home },
  { id: 'activity', label: '动态', icon: CircleGauge },
  { id: 'sources', label: '数据源', icon: Database },
  { id: 'notifications', label: '通知', icon: Bell },
  { id: 'settings', label: '设置', icon: Settings },
];

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(api ? emptySnapshot : demoSnapshot);
  const [page, setPage] = useState<Page>('overview');
  const [collapsed, setCollapsed] = useState(() => window.innerWidth <= 1180);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [focusedPostId, setFocusedPostId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    if (!api) return;
    void api.getSnapshot().then(setSnapshot);
    return api.onSnapshot(setSnapshot);
  }, []);

  useEffect(() => api?.onNavigatePost((postId) => {
    setFocusedPostId(postId);
    setPage('overview');
  }), []);

  const runCheck = async () => api && setSnapshot(await api.checkNow());
  const currentTitle = navigation.find((item) => item.id === page)?.label ?? '总览';

  return (
    <div className={`app ${collapsed ? 'sidebar-collapsed' : ''}`} data-theme={theme}>
      <header className="titlebar">
        <button className="icon-button menu-button" onClick={() => setCollapsed((value) => !value)} aria-label="切换导航"><Menu /></button>
        <strong>Tibo Watch</strong><span>Codex 重置监测</span>
        <div className="window-actions">
          <button onClick={() => void api?.windowAction('minimize')} aria-label="最小化"><Minimize2 /></button>
          <button onClick={() => void api?.windowAction('maximize')} aria-label="最大化"><Square /></button>
          <button onClick={() => void api?.windowAction('close')} aria-label="关闭"><X /></button>
        </div>
      </header>
      <aside className="sidebar">
        <nav>
          {navigation.map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)} title={item.label}><item.icon /><span>{item.label}</span></button>)}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'} title={theme === 'dark' ? '浅色模式' : '深色模式'}>
            {theme === 'dark' ? <Sun /> : <Moon />}<span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
          </button>
          <button onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? '展开导航' : '收起导航'} title={collapsed ? '展开' : '收起'}>
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}<span>{collapsed ? '展开' : '收起'}</span>
          </button>
        </div>
      </aside>
      <main className="content" aria-label={currentTitle}>
        {page === 'overview' && <Overview key={focusedPostId ?? 'overview'} snapshot={snapshot} onCheck={runCheck} initialPostId={focusedPostId} />}
        {page === 'activity' && <Activity snapshot={snapshot} />}
        {page === 'sources' && <Sources snapshot={snapshot} onCheck={runCheck} />}
        {page === 'notifications' && <Notifications snapshot={snapshot} onUpdated={setSnapshot} />}
        {page === 'settings' && <SettingsPage key={JSON.stringify(snapshot.settings)} snapshot={snapshot} onSaved={setSnapshot} />}
      </main>
      <footer className="statusbar"><span><i className="status-dot" />{snapshot.paused ? '监测已暂停' : '后台监测中'} · 每 {snapshot.settings.pollIntervalMinutes} 分钟检查</span><span>版本 {snapshot.version} <CheckCircle2 /></span></footer>
      {api && !snapshot.settings.onboardingComplete && <Onboarding snapshot={snapshot} onDone={setSnapshot} />}
    </div>
  );
}

function Overview({ snapshot, onCheck, initialPostId }: { snapshot: AppSnapshot; onCheck: () => Promise<void> | undefined; initialPostId: string | null }) {
  const [filter, setFilter] = useState<'all' | Exclude<SignalLevel, 'irrelevant'>>('all');
  const filtered = snapshot.posts.filter((item) => filter === 'all' || item.classification?.level === filter);
  const [selectedId, setSelectedId] = useState(initialPostId ?? snapshot.posts[0]?.post.id ?? '');
  const selected = snapshot.posts.find((item) => item.post.id === selectedId) ?? snapshot.posts[0];
  const latest = snapshot.posts.find((item) => item.classification?.level === 'confirmed');
  return <div className="overview-layout">
    <section className="hero-panel">
      <div className="current-state">
        <h2>当前状态</h2>
        <div className="signal-summary confirmed"><div className="summary-icon"><Check /></div><div><h1>{latest ? '已确认重置' : '尚未确认新的重置'}</h1><p>{latest?.post.text ?? '正在等待 Tibo 发布新的 Codex 重置动态。'}</p><dl><div><dt><Clock3 />最近检查</dt><dd>{time(snapshot.lastCheckedAt)}</dd></div><div><dt><Clock3 />下次检查</dt><dd>{time(snapshot.nextCheckAt)}</dd></div></dl><button className="outline-button" onClick={() => latest && openPost(latest.post.url)}><ExternalLink />查看原帖</button></div></div>
      </div>
      <div className="runtime-state"><h2>运行状态</h2><label>数据源</label>{snapshot.sourceHealth.map((source) => <div className="health-row" key={source.sourceId}>{source.sourceId === 'x-browser' ? <X /> : <Zap />}<span>{source.label}</span><Status state={source.state} /></div>)}<label>通知服务</label><div className="health-row"><Square /><span>Windows 通知</span><em><i />已启用</em></div><div className="health-row"><Mail /><span>邮件通知</span><em><i />{snapshot.settings.emailEnabled ? '已发送' : '未启用'}</em></div><button className="link-button">查看详细状态 <ChevronRight /></button></div>
    </section>
    <section className="feed-panel">
      <div className="feed-list"><div className="tabs">{([['all','全部'],['confirmed','确认'],['preview','预告'],['related','相关']] as const).map(([id,label]) => <button className={filter === id ? 'active' : ''} onClick={() => setFilter(id)} key={id}>{label}</button>)}</div><div className="timeline">{filtered.map((item) => <TimelineRow key={item.post.id} item={item} selected={selected?.post.id === item.post.id} onClick={() => setSelectedId(item.post.id)} />)}</div><div className="feed-footer"><span>共 {snapshot.posts.length} 条记录</span><button onClick={() => void onCheck()}><RefreshCw className={snapshot.checking ? 'spin' : ''}/>刷新</button></div></div>
      <div className="detail-pane">{selected ? <PostDetail item={selected} /> : <Empty label="尚无动态记录" />}</div>
    </section>
  </div>;
}

function TimelineRow({ item, selected, onClick }: { item: PostView; selected: boolean; onClick: () => void }) {
  const level = item.classification?.level ?? 'irrelevant';
  return <button className={`timeline-row ${selected ? 'selected' : ''} ${level}`} onClick={onClick}><span className="timeline-marker">{level === 'confirmed' ? <Check /> : level === 'preview' ? <Clock3 /> : <Info />}</span><time>{date(item.post.createdAt)}<strong>{time(item.post.createdAt)}</strong><small>北京时间</small></time><span className="post-copy"><strong>{item.post.text}</strong><small>Tibo · @thsottiaux</small></span><LevelLabel level={level}/><ChevronRight /></button>;
}

function PostDetail({ item }: { item: PostView }) {
  const level = item.classification?.level ?? 'irrelevant';
  return <div className="post-detail"><div className={`detail-heading ${level}`}><LevelIcon level={level}/><strong><LevelLabel level={level}/></strong><time>{fullDate(item.post.createdAt)} 北京时间</time></div><h3>判定依据</h3><p>{item.classification?.reasons.join('；') ?? '尚未分类。'}</p><h3>匹配关键词</h3><div className="term-list">{item.classification?.matchedTerms.map((term) => <span key={term}>{term}</span>)}</div><h3>来源证据</h3><button className="source-link" onClick={() => openPost(item.post.url)}><X />{item.post.url}<ExternalLink /></button><h3>邮件送达状态</h3><p><Mail /> {level === 'confirmed' || level === 'preview' ? '已发送至已配置收件人' : '相关动态仅发送静默 Windows 通知'}</p><button className="outline-button detail-open" onClick={() => openPost(item.post.url)}>查看原帖 <ExternalLink /></button></div>;
}

function Activity({ snapshot }: { snapshot: AppSnapshot }) { return <PageShell title="动态" subtitle="查看所有监测到的原创、回复与引用动态"><div className="simple-list">{snapshot.posts.map((item) => <TimelineRow key={item.post.id} item={item} selected={false} onClick={() => openPost(item.post.url)}/>)}</div></PageShell>; }
function Sources({ snapshot, onCheck }: { snapshot: AppSnapshot; onCheck: () => Promise<void> | undefined }) { return <PageShell title="数据源" subtitle="检查 X 登录会话和公共 RSS 的健康状态"><div className="source-grid">{snapshot.sourceHealth.map((source) => <section key={source.sourceId}><h3>{source.label}</h3><Status state={source.state}/><p>连续失败：{source.consecutiveFailures} 次</p><p>最近成功：{fullDate(source.lastSuccessAt)}</p></section>)}</div><button className="outline-button" onClick={() => void onCheck()}><RefreshCw/>立即检查全部</button></PageShell>; }
function Notifications({ snapshot, onUpdated }: { snapshot: AppSnapshot; onUpdated: (value: AppSnapshot) => void }) { return <PageShell title="通知" subtitle="查看信号事件与邮件重试状态"><div className="notification-list">{snapshot.events.length ? snapshot.events.map((event) => <div key={event.id}><LevelIcon level={event.level}/><span><strong>{labelFor(event.level)}</strong><small>{fullDate(event.detectedAt)} · {event.isEscalation ? '由预告升级' : '首次识别'}</small></span></div>) : <Empty label="尚无通知记录"/>}</div>{snapshot.mailQueue.length > 0 && <section className="retry-list"><h2>邮件重试队列</h2>{snapshot.mailQueue.map((item) => <div key={item.id}><span><strong>{item.status === 'failed' ? '最终发送失败' : item.status === 'sent' ? '已发送' : `等待第 ${item.attempt} 次重试`}</strong><small>{item.lastError ?? `计划时间：${fullDate(item.nextAttemptAt)}`}</small></span>{item.status === 'failed' && <button className="outline-button" onClick={async () => api && onUpdated(await api.retryMail(item.id))}><RefreshCw/>重新发送</button>}</div>)}</section>}</PageShell>; }

function SettingsPage({ snapshot, onSaved }: { snapshot: AppSnapshot; onSaved: (value: AppSnapshot) => void }) {
  const [form, setForm] = useState<RendererSettings>(snapshot.settings);
  const [password, setPassword] = useState('');
  const [testState, setTestState] = useState('');
  const update = <K extends keyof RendererSettings>(key: K, value: RendererSettings[K]) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => { if (!api) return; const payload: SettingsUpdate = { pollIntervalMinutes: form.pollIntervalMinutes, browserSourceEnabled: form.browserSourceEnabled, publicRssEnabled: form.publicRssEnabled, startAtLogin: form.startAtLogin, closeToTray: form.closeToTray, baselineComplete: form.baselineComplete, onboardingComplete: form.onboardingComplete, emailEnabled: form.emailEnabled, emailRecipients: form.emailRecipients, smtpHost: form.smtpHost, smtpPort: form.smtpPort, smtpSecure: form.smtpSecure, smtpUsername: form.smtpUsername, smtpFrom: form.smtpFrom, ...(password ? { smtpPassword: password } : {}) }; onSaved(await api.updateSettings(payload)); setPassword(''); };
  const test = async () => { if (!api) { setTestState('演示模式：测试邮件已发送'); return; } const result = await api.sendTestEmail(); setTestState(result.ok ? '测试邮件已发送' : `发送失败：${result.errorCode}`); };
  return <PageShell title="设置" subtitle="配置数据源、通知与后台运行" className="settings-page"><div className="settings-columns"><div className="settings-column"><SettingsSection title="X 登录抓取"><div className="login-status"><span><i className="status-dot"/> {snapshot.xLoggedIn ? '已登录 · @thsottiaux' : '尚未登录'}</span><div><button className="outline-button" onClick={() => void api?.openXLogin()}><RefreshCw/>{snapshot.xLoggedIn ? '重新登录' : '登录 X'}</button>{snapshot.xLoggedIn && <button className="neutral-button" onClick={() => void api?.logoutX()}><LogOut/>退出登录</button>}</div></div><Toggle checked={form.browserSourceEnabled} onChange={(value) => update('browserSourceEnabled', value)} label="启用 X 登录抓取"/><p className="warning"><ShieldAlert/>脚本化访问 X 可能违反其服务条款，且可能被限制或封禁。可在本节单独禁用登录抓取而不影响公共 RSS。</p></SettingsSection><SettingsSection title="公共 RSS"><Toggle checked={form.publicRssEnabled} onChange={(value) => update('publicRssEnabled', value)} label="启用公共 RSS"/><label className="field-label">Nitter 实例来源（按优先级顺序）</label><div className="instance-list">{['https://nitter.privacyredirect.com','注册表自动故障切换','最后可用实例缓存'].map((value,index) => <div key={value}><b>{index + 1}</b><span>{value}</span><em><i/>正常</em></div>)}</div><button className="outline-button"><RefreshCw/>检测全部</button></SettingsSection><SettingsSection title="监测"><FormRow label="检查间隔"><select value={form.pollIntervalMinutes} onChange={(event) => update('pollIntervalMinutes', Number(event.target.value))}><option value={5}>每 5 分钟</option><option value={10}>每 10 分钟</option><option value={15}>每 15 分钟</option></select></FormRow><Toggle checked={form.startAtLogin} onChange={(value) => update('startAtLogin', value)} label="开机自启"/><Toggle checked={form.closeToTray} onChange={(value) => update('closeToTray', value)} label="关闭窗口时继续在托盘运行"/></SettingsSection></div><div className="settings-column"><SettingsSection title="Windows 通知"><div className="sound-row"><CheckCircle2/><span>确认重置</span><Toggle checked label=""/><select><option>默认声音</option></select></div><div className="sound-row"><Clock3/><span>预告</span><Toggle checked label=""/><select><option>默认声音</option></select></div><div className="sound-row"><Info/><span>其他相关动态</span><Toggle checked label=""/><select><option>静音（无声）</option></select></div></SettingsSection><SettingsSection title="邮件通知"><Toggle checked={form.emailEnabled} onChange={(value) => update('emailEnabled', value)} label="启用邮件通知"/><div className="smtp-grid"><FormRow label="SMTP 主机"><input value={form.smtpHost} onChange={(event) => update('smtpHost', event.target.value)}/></FormRow><FormRow label="端口"><input type="number" value={form.smtpPort} onChange={(event) => update('smtpPort', Number(event.target.value))}/></FormRow></div><FormRow label="加密方式"><select value={form.smtpSecure ? 'ssl' : 'starttls'} onChange={(event) => update('smtpSecure', event.target.value === 'ssl')}><option value="starttls">STARTTLS</option><option value="ssl">SSL / TLS</option></select></FormRow><FormRow label="用户名"><input value={form.smtpUsername} onChange={(event) => update('smtpUsername', event.target.value)}/></FormRow><FormRow label="应用密码"><input type="password" value={password} placeholder={form.hasSmtpPassword ? '已安全保存；留空则不修改' : '请输入应用密码'} onChange={(event) => setPassword(event.target.value)}/></FormRow><FormRow label="发件人名称"><input value={form.smtpFrom} onChange={(event) => update('smtpFrom', event.target.value)}/></FormRow><FormRow label="收件人地址（多个用逗号或换行分隔）"><textarea value={form.emailRecipients.join(', ')} onChange={(event) => update('emailRecipients', event.target.value.split(/[\n,;]/).map((value) => value.trim()).filter(Boolean))}/></FormRow><div className="save-row"><button className="outline-button" onClick={() => void test()}><Send/>发送测试邮件</button>{testState && <em><CheckCircle2/>{testState}</em>}<button className="primary-button" onClick={() => void save()}><Save/>保存设置</button></div></SettingsSection></div></div></PageShell>;
}

function Onboarding({ snapshot, onDone }: { snapshot: AppSnapshot; onDone: (value: AppSnapshot) => void }) { return <div className="onboarding-backdrop"><section className="onboarding"><div className="brand-mark"><Zap/></div><h1>开始监测 Codex 重置</h1><p>Tibo Watch 将每 5 分钟检查 @thsottiaux 的动态，并在确认或预告重置时提醒你。</p><ul><li><Check/>公共 RSS 已默认启用</li><li><ShieldAlert/>X 登录抓取可稍后在设置中启用</li><li><Mail/>邮件密码由 Windows DPAPI 加密保存</li></ul><button className="primary-button" onClick={async () => onDone(api ? await api.completeOnboarding() : { ...snapshot, settings: { ...snapshot.settings, onboardingComplete: true, baselineComplete: true } })}>建立历史基线并开始</button></section></div>; }
function PageShell({ title, subtitle, className = '', children }: { title: string; subtitle: string; className?: string; children: React.ReactNode }) { return <div className={`page-shell ${className}`}><header><h1>{title}</h1><p>{subtitle}</p></header>{children}</div>; }
function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="settings-section"><h2>{title}</h2>{children}</section>; }
function FormRow({ label, children }: { label: string; children: React.ReactNode }) { return <label className="form-row"><span>{label}</span>{children}</label>; }
function Toggle({ checked, onChange = () => {}, label }: { checked: boolean; onChange?: (value: boolean) => void; label: string }) { return <label className="toggle-row"><button type="button" role="switch" aria-checked={checked} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><i/></button>{label && <span>{label}</span>}</label>; }
function Empty({ label }: { label: string }) { return <div className="empty"><Info/><span>{label}</span></div>; }
function Status({ state }: { state: string }) { const disabled = state === 'disabled'; return <em className={state === 'online' ? '' : disabled ? 'status-disabled' : 'status-error'}><i/>{state === 'online' ? '在线' : state === 'stale' ? '已过期' : state === 'needs_login' ? '需登录' : disabled ? '已停用' : '异常'}</em>; }
function LevelIcon({ level }: { level: SignalLevel }) { return level === 'confirmed' ? <CheckCircle2/> : level === 'preview' ? <Clock3/> : <Info/>; }
function LevelLabel({ level }: { level: SignalLevel }) { return <span className={`level-label ${level}`}>{labelFor(level)}</span>; }
function labelFor(level: SignalLevel) { return level === 'confirmed' ? '已确认重置' : level === 'preview' ? '预告' : level === 'related' ? '相关' : '无关'; }
function time(value: string | null) { return value ? new Intl.DateTimeFormat('zh-CN',{ timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false }).format(new Date(value)) : '—'; }
function date(value: string) { return new Intl.DateTimeFormat('zh-CN',{ timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date(value)).replaceAll('/','-'); }
function fullDate(value: string | null) { return value ? `${date(value)} ${time(value)}` : '—'; }
function openPost(url: string) { if (api) void api.openPost(url); else window.open(url, '_blank', 'noopener,noreferrer'); }
