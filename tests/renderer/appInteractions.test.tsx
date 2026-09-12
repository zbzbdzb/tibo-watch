// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AppSnapshot, TiboWatchApi } from '../../src/shared/api';
import { App } from '../../src/renderer/App';
import { demoSnapshot } from '../../src/renderer/demoData';

let snapshot: AppSnapshot;
let api: TiboWatchApi;
let push: (snapshot: AppSnapshot) => void;
let navigatePost: (id: string) => void;
const nav = (name: string) => fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name, exact: true }));
const visiblePage = () => within(document.querySelector('.page-view:not([hidden])') as HTMLElement);
async function start() { render(<App/>); await screen.findByRole('heading', { name: '监测总览' }); }
beforeEach(() => {
  localStorage.clear();
  snapshot = structuredClone(demoSnapshot);
  push = () => {}; navigatePost = () => {};
  api = {
    getSnapshot: vi.fn(async () => structuredClone(snapshot)),
    updateSettings: vi.fn(async patch => { const { smtpPassword, ...settings } = patch; snapshot.settings = { ...snapshot.settings, ...settings, hasSmtpPassword: !!smtpPassword || snapshot.settings.hasSmtpPassword }; return structuredClone(snapshot); }),
    checkNow: vi.fn(async () => structuredClone(snapshot)),
    setPaused: vi.fn(async paused => { snapshot.paused = paused; return structuredClone(snapshot); }),
    openXLogin: vi.fn(async () => { snapshot.settings.browserSourceEnabled = true; return structuredClone(snapshot); }),
    logoutX: vi.fn(async () => structuredClone(snapshot)),
    sendTestEmail: vi.fn(async () => ({ ok: true, errorCode: null })),
    openPost: vi.fn(async () => {}),
    completeOnboarding: vi.fn(async () => structuredClone(snapshot)),
    retryMail: vi.fn(async () => structuredClone(snapshot)),
    windowAction: vi.fn(async () => {}),
    onSnapshot: vi.fn(listener => { push = listener; return () => {}; }),
    onNavigatePost: vi.fn(listener => { navigatePost = listener; return () => {}; }),
  };
  window.tiboWatch = api;
});
afterEach(() => { cleanup(); localStorage.clear(); delete window.tiboWatch; vi.useRealTimers(); });

it.each([
  ['syncing','X_COLLECTION_POSTS_LOADING','同步中'],
  ['partial','X_COLLECTION_DETAILS_PENDING','部分采集完成'],
  ['stale','X_COLLECTION_POSTS_STALE','数据已超时'],
  ['needs_login','X_SESSION_EXPIRED','需重新登录'],
] as const)('preserves truthful %s state in overview and source details', async (state,errorCode,label) => {
  Object.assign(snapshot.sourceHealth[0]!, { state,errorCode });
  await start();
  expect(visiblePage().getByText(label)).toBeVisible();
  nav('数据源');
  expect(visiblePage().getByText(label)).toBeVisible();
  expect(visiblePage().getByText(errorCode)).toBeVisible();
  expect(screen.queryByText('已过期')).not.toBeInTheDocument();
});

it('does not show onboarding while the real snapshot is loading or fails', async () => {
  vi.mocked(api.getSnapshot).mockRejectedValue(new Error('OFFLINE'));
  render(<App/>);
  await screen.findByRole('heading', { name: '无法加载监测状态' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('replaces sidebar and bookmarks with top navigation and four inbox filters', async () => {
  await start(); nav('动态收件箱');
  expect(screen.queryByRole('button', { name: '展开导航' })).not.toBeInTheDocument();
  expect(screen.queryByText(/收藏/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  fireEvent.click(screen.getByRole('tab', { name: /^确认/ }));
  expect(document.querySelectorAll('.inbox-scroll .post-row')).toHaveLength(1);
  fireEvent.change(screen.getByRole('textbox', { name: '搜索动态' }), { target: { value: 'no match xyz' } });
  expect(screen.getByRole('heading', { name: '没有找到匹配的动态' })).toBeVisible();
});

it('shows complete original and quote, plain explanation, real sources and no invented delivery', async () => {
  snapshot.posts[0]!.post.quotedText = 'A quoted public update.';
  snapshot.posts[0]!.post.sourceIds = ['public-rss'];
  await start(); nav('动态收件箱');
  expect(screen.getByLabelText('动态原文')).toHaveTextContent(snapshot.posts[0]!.post.text);
  expect(screen.getByText('A quoted public update.')).toBeVisible();
  expect(screen.getByRole('heading', { name: '判断说明' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: '原文证据' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '判定证据' })).not.toBeInTheDocument();
  expect(screen.getByText('无发送记录（历史基线或未触发提醒）')).toBeVisible();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '查看原帖' })));
  expect(api.openPost).toHaveBeenCalledWith(snapshot.posts[0]!.post.url);
});

it('keeps independent Windows sound and channel preferences with scoped persistence', async () => {
  await start(); nav('通知');
  await act(async () => fireEvent.click(screen.getByRole('switch', { name: '确认重置通知' })));
  expect(api.updateSettings).toHaveBeenLastCalledWith({ windowsConfirmedEnabled: false });
  expect(screen.getByRole('button', { name: '确认重置声音已开启' })).toBeDisabled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '预告声音已开启' })));
  expect(api.updateSettings).toHaveBeenLastCalledWith({ windowsPreviewSound: false });
  nav('总览'); expect(visiblePage().getByText('部分启用')).toBeVisible();
  nav('通知'); expect(screen.getByRole('button', { name: '预告声音已关闭' })).toBeVisible();
  expect(screen.getByRole('switch', { name: '启用邮件提醒' })).toBeChecked();
});

it('retains old values on save failure and rejects overlapping mutations', async () => {
  await start(); nav('数据源');
  vi.mocked(api.updateSettings).mockRejectedValueOnce(new Error('FAIL'));
  await act(async () => fireEvent.click(screen.getByRole('switch', { name: '启用公共 RSS' })));
  expect(screen.getByRole('switch', { name: '启用公共 RSS' })).toBeChecked();
  expect(screen.getByRole('status')).toHaveTextContent('操作失败');
  let done!: (value: AppSnapshot) => void;
  vi.mocked(api.updateSettings).mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
  fireEvent.click(screen.getByRole('switch', { name: '启用公共 RSS' }));
  expect(screen.getByRole('switch', { name: '启用 Chrome 登录共享' })).toBeDisabled();
  fireEvent.click(screen.getByRole('switch', { name: '启用 Chrome 登录共享' }));
  expect(api.updateSettings).toHaveBeenCalledTimes(2);
  await act(async () => done(structuredClone(snapshot)));
});

it('preserves RSS preference across pages and incoming snapshots', async () => {
  await start(); nav('数据源');
  await act(async () => fireEvent.click(screen.getByRole('switch', { name: '启用公共 RSS' })));
  nav('设置'); nav('数据源');
  expect(screen.getByRole('switch', { name: '启用公共 RSS' })).not.toBeChecked();
  await act(async () => push(structuredClone(snapshot)));
  expect(screen.getByRole('switch', { name: '启用公共 RSS' })).not.toBeChecked();
});

it('keeps SMTP drafts on broadcasts and discards them on cancellation; saves only SMTP fields', async () => {
  await start(); nav('通知');
  fireEvent.click(screen.getByRole('button', { name: '编辑 SMTP 配置' }));
  fireEvent.change(screen.getByLabelText('SMTP 主机'), { target: { value: 'draft.example.com' } });
  await act(async () => push(structuredClone(snapshot)));
  expect(screen.getByLabelText('SMTP 主机')).toHaveValue('draft.example.com');
  fireEvent.click(screen.getByRole('button', { name: '取消', exact: true }));
  expect(api.updateSettings).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '编辑 SMTP 配置' }));
  expect(screen.getByLabelText('SMTP 主机')).toHaveValue(snapshot.settings.smtpHost);
  fireEvent.change(screen.getByLabelText('SMTP 主机'), { target: { value: 'smtp.test.local' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存邮件配置' })));
  const payload = vi.mocked(api.updateSettings).mock.calls[0]![0];
  expect(payload).toMatchObject({ smtpHost: 'smtp.test.local' });
  expect(payload).not.toHaveProperty('smtpPassword');
  expect(payload).not.toHaveProperty('emailRecipients');
  expect(payload).not.toHaveProperty('publicRssEnabled');
});

it.each([
  ['EMAIL_PROXY_UNAVAILABLE', '无法通过系统代理连接邮件服务器'],
  ['EMAIL_CONNECTION_TIMEOUT', '连接 SMTP 服务器超时'],
  ['EAUTH', 'SMTP 账号验证失败'],
  ['ETIMEDOUT', '旧记录未区分阶段'],
])('explains test-mail failure %s without changing SMTP settings', async (code, label) => {
  vi.mocked(api.sendTestEmail).mockResolvedValue({ ok: false, errorCode: code });
  await start(); nav('通知');
  expect(api.sendTestEmail).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送测试邮件' })));
  expect(screen.getByRole('status')).toHaveTextContent(label);
  expect(screen.getByRole('status')).toHaveTextContent(code);
  expect(api.updateSettings).not.toHaveBeenCalled();
  expect(api.sendTestEmail).toHaveBeenCalledTimes(1);
});

it('validates recipients and sends test email only on explicit click', async () => {
  await start(); nav('通知');
  fireEvent.click(screen.getByRole('button', { name: '添加', exact: true }));
  fireEvent.change(screen.getByLabelText('邮箱地址'), { target: { value: 'invalid' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '添加收件人', exact: true })));
  expect(screen.getByRole('alert')).toHaveTextContent('请输入完整邮箱');
  expect(api.updateSettings).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('邮箱地址'), { target: { value: 'extra@example.com' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '添加收件人', exact: true })));
  expect(snapshot.settings.emailRecipients).toContain('extra@example.com');
  expect(api.sendTestEmail).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送测试邮件' })));
  expect(api.sendTestEmail).toHaveBeenCalledOnce();
});

it('retains theme preference and only useful settings categories', async () => {
  await start();
  expect(document.querySelector('.app')).toHaveAttribute('data-theme','dark');
  fireEvent.click(screen.getByRole('button', { name: '切换到浅色模式' }));
  expect(localStorage.getItem('tibo-watch-theme')).toBe('light');
  nav('设置');
  expect(within(screen.getByRole('navigation', { name: '设置分类' })).getAllByRole('button')).toHaveLength(3);
  expect(screen.queryByText('识别与状态')).not.toBeInTheDocument();
  await act(async () => fireEvent.change(screen.getByLabelText('检查间隔'), { target: { value: '10' } }));
  expect(api.updateSettings).toHaveBeenLastCalledWith({ pollIntervalMinutes: 10 });
});

it('removes requested decorative copy and the non-editable display-time row', async () => {
  await start(); nav('通知'); nav('设置');
  fireEvent.click(within(screen.getByRole('navigation', { name: '设置分类' })).getByRole('button', { name: '外观' }));
  for (const text of ['决定哪些变化值得打扰，以及用什么方式。', '开关修改即时保存', '偏好即时保存', '让 Tibo Watch 按照你的习惯，安静运行。', '在及时性和安静运行之间，找到你的平衡。', '一种清晰的秩序，两种舒适的光线。', '显示时间']) {
    expect(screen.queryByText(text)).not.toBeInTheDocument();
  }
});

it('converts Pacific dates, swaps direction, and retains the conversion across navigation without saving settings', async () => {
  await start(); nav('设置');
  const categories = within(screen.getByRole('navigation', { name: '设置分类' }));
  fireEvent.click(categories.getByRole('button', { name: '时区换算' }));
  fireEvent.change(screen.getByLabelText('来源日期'), { target: { value: '2026-09-12' } });
  fireEvent.change(screen.getByLabelText('来源时间'), { target: { value: '14:00' } });
  expect(screen.getByLabelText('换算结果')).toHaveTextContent('2026-09-13 05:00');
  expect(screen.getByLabelText('换算结果')).toHaveTextContent('PDT');
  expect(screen.getByLabelText('换算结果')).toHaveTextContent('次日');
  fireEvent.click(screen.getByRole('button', { name: '交换来源与目标时区' }));
  expect(screen.getByLabelText('来源时区')).toHaveValue('Asia/Shanghai');
  expect(screen.getByLabelText('目标时区')).toHaveValue('America/Los_Angeles');
  expect(screen.getByLabelText('换算结果')).toHaveTextContent('2026-09-12 14:00');
  expect(screen.getByLabelText('换算结果')).toHaveTextContent('前一日');
  fireEvent.click(categories.getByRole('button', { name: '外观' }));
  fireEvent.click(categories.getByRole('button', { name: '时区换算' }));
  nav('总览'); nav('设置');
  await act(async () => push(structuredClone(snapshot)));
  expect(screen.getByLabelText('来源日期')).toHaveValue('2026-09-13');
  expect(screen.getByLabelText('来源时间')).toHaveValue('05:00');
  expect(api.updateSettings).not.toHaveBeenCalled();
  expect(api.sendTestEmail).not.toHaveBeenCalled();
});

it('requires a choice for repeated clock times and never displays a guessed gap result', async () => {
  await start(); nav('设置');
  fireEvent.click(screen.getByRole('button', { name: '时区换算' }));
  fireEvent.change(screen.getByLabelText('来源日期'), { target: { value: '2026-11-01' } });
  fireEvent.change(screen.getByLabelText('来源时间'), { target: { value: '01:30' } });
  expect(screen.getByLabelText('换算结果')).toHaveTextContent('选择具体时刻');
  expect(screen.getByRole('button', { name: '交换来源与目标时区' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('重复时间的具体时刻'), { target: { value: '1' } });
  expect(screen.getByLabelText('换算结果')).toHaveTextContent('2026-11-01 17:30');
  fireEvent.change(screen.getByLabelText('来源日期'), { target: { value: '2026-03-08' } });
  fireEvent.change(screen.getByLabelText('来源时间'), { target: { value: '02:30' } });
  expect(screen.getByRole('alert')).toHaveTextContent('不存在');
  expect(screen.getByLabelText('换算结果')).not.toHaveTextContent('17:30');
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T21:00:00Z'));
  fireEvent.click(screen.getByRole('button', { name: '使用当前时间' }));
  expect(screen.getByLabelText('来源日期')).toHaveValue('2026-09-12');
  expect(screen.getByLabelText('来源时间')).toHaveValue('14:00');
  expect(screen.getByLabelText('换算结果')).toHaveTextContent('2026-09-13 05:00');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('routes notification clicks to the exact post and delegates native window actions', async () => {
  await start();
  await act(async () => navigatePost(snapshot.posts[1]!.post.id));
  expect(screen.getByRole('heading', { name: '动态收件箱' })).toBeVisible();
  expect(screen.getByLabelText('动态原文')).toHaveTextContent(snapshot.posts[1]!.post.text);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '关闭', exact: true })));
  expect(api.windowAction).toHaveBeenCalledWith('close');
});

it('keeps automatic status expiry and real pause/resume', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T11:59:00Z'));
  snapshot.posts = [{ ...snapshot.posts[0]!, post: { ...snapshot.posts[0]!.post, createdAt:'2026-09-12T00:00:00Z' } }];
  snapshot.lastCheckedAt = '2026-09-12T11:59:00Z';
  render(<App/>);
  await act(async () => {});
  expect(screen.getByRole('heading', { name: '新一轮重置，已宣布执行' })).toBeVisible();
  await act(async () => vi.advanceTimersByTimeAsync(120000));
  expect(screen.getByRole('heading', { name: '正在留意下一次重置' })).toBeVisible();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '暂停监测' })));
  expect(api.setPaused).toHaveBeenCalledWith(true);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '恢复监测' })));
  expect(api.setPaused).toHaveBeenLastCalledWith(false);
});
