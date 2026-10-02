// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AppSnapshot, TiboWatchApi } from '../../src/shared/api';
import { App } from '../../src/renderer/App';
import { demoSnapshot } from '../../src/renderer/demoData';

let snapshot: AppSnapshot;
let api: TiboWatchApi;
let push: (value: AppSnapshot) => void;
let release: (value: AppSnapshot) => void;
const page = () => within(document.querySelector('.page-view:not([hidden])') as HTMLElement);
const card = (name: string) => within(screen.getByRole('heading', { name, exact: true }).closest('section')!);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  snapshot = structuredClone(demoSnapshot);
  push = () => {};
  api = {
    getSnapshot: async () => structuredClone(snapshot),
    checkNow: vi.fn(() => new Promise(resolve => { release = resolve; })),
    updateSettings: async () => structuredClone(snapshot),
    setPaused: async () => structuredClone(snapshot),
    openXLogin: async () => structuredClone(snapshot),
    logoutX: async () => structuredClone(snapshot),
    sendTestEmail: async () => ({ ok: true, errorCode: null }),
    openPost: async () => {},
    completeOnboarding: async () => structuredClone(snapshot),
    retryMail: async () => structuredClone(snapshot),
    windowAction: async () => {},
    onSnapshot: listener => { push = listener; return () => {}; },
    onNavigatePost: () => () => {},
  };
  window.tiboWatch = api;
  localStorage.clear();
});
afterEach(() => { cleanup(); delete window.tiboWatch; vi.useRealTimers(); });

async function start() {
  await act(async () => { render(<App/>); });
  fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '数据源', exact: true }));
}
async function finish() {
  await act(async () => { release(structuredClone(snapshot)); });
  await act(async () => { await vi.advanceTimersByTimeAsync(650); });
}

it.each([
  ['Chrome 登录共享', 'x-browser', '公共 RSS'],
  ['公共 RSS', 'public-rss', 'Chrome 登录共享'],
])('checks only %s and keeps unrelated controls idle', async (name, sourceId, otherName) => {
  await start();
  fireEvent.click(card(name!).getByRole('button', { name: '检查连接' }));
  expect(card(name!).getByRole('button', { name: '正在检查…' })).toBeDisabled();
  expect(card(otherName!).getByRole('button', { name: '检查连接' })).toBeDisabled();
  expect(page().getByRole('button', { name: '检查全部来源' })).toBeDisabled();
  expect(page().getAllByRole('button', { name: '正在检查…' })).toHaveLength(1);
  expect(api.checkNow).toHaveBeenCalledWith(sourceId);
  fireEvent.click(card(otherName!).getByRole('button', { name: '检查连接' }));
  expect(api.checkNow).toHaveBeenCalledTimes(1);
  fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '总览', exact: true }));
  expect(page().getByRole('button', { name: '立即检查' })).toBeDisabled();
  expect(page().queryByRole('button', { name: '正在检查…' })).not.toBeInTheDocument();
  await finish();
  expect(page().getByRole('button', { name: '立即检查' })).toBeEnabled();
});

it('shows all-source progress only on the all-source control and returns every control to idle', async () => {
  await start();
  fireEvent.click(page().getByRole('button', { name: '检查全部来源' }));
  expect(page().getAllByRole('button', { name: '正在检查…' })).toHaveLength(1);
  expect(page().getAllByRole('button', { name: '检查连接' }).every(button => button.hasAttribute('disabled'))).toBe(true);
  expect(api.checkNow).toHaveBeenCalledWith();
  await finish();
  expect(page().getByRole('button', { name: '检查全部来源' })).toBeEnabled();
  expect(page().getAllByRole('button', { name: '检查连接' }).every(button => !button.hasAttribute('disabled'))).toBe(true);
});

it('uses pushed source scope for backend checks and treats older global snapshots as all-source checks', async () => {
  await start();
  await act(async () => push({ ...snapshot, checking: true, checkingTarget: 'x-browser' } as AppSnapshot));
  expect(card('Chrome 登录共享').getByRole('button', { name: '正在检查…' })).toBeDisabled();
  expect(card('公共 RSS').getByRole('button', { name: '检查连接' })).toBeDisabled();
  expect(page().getByRole('button', { name: '检查全部来源' })).toBeDisabled();
  await act(async () => push({ ...snapshot, checking: true }));
  expect(page().getAllByRole('button', { name: '正在检查…' })).toHaveLength(1);
  expect(page().getAllByRole('button', { name: '检查连接' }).every(button => button.hasAttribute('disabled'))).toBe(true);
  await act(async () => push({ ...snapshot, checking: false }));
  expect(page().queryByRole('button', { name: '正在检查…' })).not.toBeInTheDocument();
});

it('reports the targeted source failure and releases every control after a rejected request', async () => {
  await start();
  vi.mocked(api.checkNow).mockRejectedValueOnce(new Error('SOURCE_CHECK_FAILED'));
  await act(async () => fireEvent.click(card('Chrome 登录共享').getByRole('button', { name: '检查连接' })));
  expect(screen.getByRole('status')).toHaveTextContent('检查失败');
  await act(async () => { await vi.advanceTimersByTimeAsync(650); });
  expect(page().getByRole('button', { name: '检查全部来源' })).toBeEnabled();
  expect(card('公共 RSS').getByRole('button', { name: '检查连接' })).toBeEnabled();
});

it('uses targeted health rather than an unrelated historical global error for completion feedback', async () => {
  await start();
  snapshot.lastCheckError = 'CHECK_FAILED';
  fireEvent.click(card('Chrome 登录共享').getByRole('button', { name: '检查连接' }));
  await finish();
  expect(screen.getByRole('status')).toHaveTextContent('检查完成');
  snapshot.lastCheckError = null;
  snapshot.sourceHealth[1]!.state = 'error';
  fireEvent.click(card('公共 RSS').getByRole('button', { name: '检查连接' }));
  await finish();
  expect(screen.getByRole('status')).toHaveTextContent('检查未完成');
});
