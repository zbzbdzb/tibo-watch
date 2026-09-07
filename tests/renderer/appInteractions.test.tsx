// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { App } from '../../src/renderer/App';
import { demoSnapshot } from '../../src/renderer/demoData';
import '../../src/renderer/styles.css';

describe('App navigation and appearance controls', () => {
  it.each([
    ['syncing', 'X_COLLECTION_POSTS_LOADING', '同步中'],
    ['partial', 'X_COLLECTION_DETAILS_PENDING', '部分采集完成'],
    ['stale', 'X_COLLECTION_POSTS_STALE', '数据已超时'],
    ['needs_login', 'X_SESSION_EXPIRED', '需重新登录'],
  ] as const)('keeps %s truthful across overview, source details and settings', (state, errorCode, label) => {
    const source = demoSnapshot.sourceHealth[0]!;
    const before = { ...source };
    Object.assign(source, { state, errorCode });
    try {
      render(<App />);
      expect(screen.getByText(label)).toBeVisible();
      expect(screen.queryByText('已过期')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '查看详细状态' }));
      expect(screen.getByText(label)).toBeVisible();
      expect(screen.getByText(new RegExp(errorCode))).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: '设置', exact: true }));
      expect(screen.getByText(label)).toBeVisible();
      expect(screen.queryByText('扩展未连接')).not.toBeInTheDocument();
    } finally { Object.assign(source, before); if (!before.errorCode) delete source.errorCode; }
  });
  it('restores independent Windows notification and sound controls with immediate persistence', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '设置', exact: true }));
    expect(screen.getByRole('switch', { name: '确认重置通知' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: '确认重置声音' })).toHaveValue('sound');
    expect(screen.getByRole('combobox', { name: '其他相关动态声音' })).toHaveValue('silent');
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: '确认重置通知' })); });
    expect(screen.getByRole('combobox', { name: '确认重置声音' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: '启用邮件通知' })).toBeChecked();
    await act(async () => { fireEvent.change(screen.getByRole('combobox', { name: '预告声音' }), { target: { value: 'silent' } }); });
    fireEvent.click(screen.getByRole('button', { name: '总览', exact: true }));
    expect(screen.getByText('部分启用')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '设置', exact: true }));
    expect(screen.getByRole('switch', { name: '确认重置通知' })).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: '预告声音' })).toHaveValue('silent');
  });

  it('does not discard unfinished SMTP drafts when saving notification preferences', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '设置', exact: true }));
    const recipients = screen.getByLabelText('收件人地址（多个用逗号或换行分隔）');
    fireEvent.change(recipients, { target: { value: 'draft@example.com, ' } });
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: '预告通知' })); });
    expect(recipients).toHaveValue('draft@example.com, ');
    expect(screen.getByText('Windows 通知设置已即时保存。')).toBeVisible();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('expands the sidebar again from its collapsed control in a narrow window', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1080 });
    render(<App />);

    const app = document.querySelector('.app');
    expect(app).toHaveClass('sidebar-collapsed');
    fireEvent.click(screen.getByRole('button', { name: '展开导航' }));
    expect(app).not.toHaveClass('sidebar-collapsed');

    fireEvent.click(screen.getByRole('button', { name: '收起导航' }));
    expect(app).toHaveClass('sidebar-collapsed');
  });

  it('switches themes and restores the saved choice', () => {
    const firstRender = render(<App />);
    const app = document.querySelector('.app');

    expect(app).toHaveAttribute('data-theme', 'dark');
    fireEvent.click(screen.getByRole('button', { name: '切换到浅色模式' }));
    expect(app).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('tibo-watch-theme')).toBe('light');

    firstRender.unmount();
    render(<App />);
    expect(document.querySelector('.app')).toHaveAttribute('data-theme', 'light');
  });

  it('presents Chrome login sharing without an embedded X login', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '设置', exact: true }));

    expect(screen.getByRole('heading', { name: 'Chrome 登录共享' })).toBeVisible();
    expect(screen.getByRole('button', { name: '安装/打开扩展' })).toBeVisible();
    expect(screen.getByRole('switch', { name: '启用 Chrome 登录共享' })).toBeChecked();
    expect(screen.getByText(/不会读取或复制 Cookie/)).toBeVisible();
  });

  it('labels matched phrases as decision evidence instead of keywords', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '判定证据' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '匹配关键词' })).not.toBeInTheDocument();
  });

  it('shows complete original text and does not invent email success for history', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: '动态原文' })).toBeVisible();
    expect(screen.getByText('无发送记录（历史基线或未触发提醒）')).toBeVisible();
    expect(screen.queryByText('已发送至已配置收件人')).not.toBeInTheDocument();
  });

  it('keeps recipient separators editable and preserves drafts on RSS autosave', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '设置', exact: true }));
    const recipients = screen.getByLabelText('收件人地址（多个用逗号或换行分隔）');
    fireEvent.change(recipients, { target: { value: 'first@example.com, ' } });
    expect(recipients).toHaveValue('first@example.com, ');
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: '启用公共 RSS' })); });
    expect(recipients).toHaveValue('first@example.com, ');
    expect(screen.queryByText('https://nitter.privacyredirect.com')).not.toBeInTheDocument();
  });

  it('shows the latest active preview instead of an older confirmed reset', () => {
    vi.useFakeTimers();
    const originalPosts = demoSnapshot.posts;
    const originalLastCheckedAt = demoSnapshot.lastCheckedAt;
    demoSnapshot.posts = [
      {
        post: {
          ...originalPosts[0]!.post,
          id: 'latest-preview',
          text: 'Reset will land around 2pm PST tomorrow.',
          createdAt: '2025-05-08T06:32:00.000Z',
        },
        classification: {
          level: 'preview', score: 8, reasons: ['明确未来重置'],
          matchedTerms: ['reset', 'tomorrow'], classifierVersion: 'rules-v5',
        },
      },
      ...originalPosts,
    ];
    demoSnapshot.lastCheckedAt = '2025-05-08T06:35:00.000Z';
    vi.setSystemTime(new Date('2025-05-08T06:35:00.000Z'));

    try {
      render(<App />);
      expect(screen.getByRole('heading', { name: '重置预告' })).toBeVisible();
      expect(screen.queryByRole('heading', { name: '已确认重置' })).not.toBeInTheDocument();
    } finally {
      demoSnapshot.posts = originalPosts;
      demoSnapshot.lastCheckedAt = originalLastCheckedAt;
      vi.useRealTimers();
    }
  });

  it('returns the current state to monitoring when the latest reset signal is stale', () => {
    const originalLastCheckedAt = demoSnapshot.lastCheckedAt;
    demoSnapshot.lastCheckedAt = '2025-05-12T06:35:00.000Z';

    try {
      render(<App />);
      expect(screen.getByRole('heading', { name: '监测中' })).toBeVisible();
      expect(screen.queryByRole('heading', { name: '已确认重置' })).not.toBeInTheDocument();
    } finally {
      demoSnapshot.lastCheckedAt = originalLastCheckedAt;
    }
  });

  it('automatically returns to monitoring when a confirmed status expires', async () => {
    vi.useFakeTimers();
    const originalPosts = demoSnapshot.posts;
    const originalLastCheckedAt = demoSnapshot.lastCheckedAt;
    const createdAt = '2025-05-08T06:00:00.000Z';
    demoSnapshot.posts = [{
      ...originalPosts[0]!,
      post: { ...originalPosts[0]!.post, createdAt },
    }];
    demoSnapshot.lastCheckedAt = '2025-05-08T17:59:00.000Z';
    vi.setSystemTime(new Date('2025-05-08T17:59:00.000Z'));

    try {
      render(<App />);
      expect(screen.getByRole('heading', { name: '已确认重置' })).toBeVisible();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2 * 60_000);
      });

      expect(screen.getByRole('heading', { name: '监测中' })).toBeVisible();
    } finally {
      demoSnapshot.posts = originalPosts;
      demoSnapshot.lastCheckedAt = originalLastCheckedAt;
      vi.useRealTimers();
    }
  });

  it('uses distinct light-theme colors for online, error, and disabled states', () => {
    const rss = demoSnapshot.sourceHealth.find((source) => source.sourceId === 'public-rss');
    if (!rss) throw new Error('RSS demo source is missing');
    const originalState = rss.state;
    const originalEmailEnabled = demoSnapshot.settings.emailEnabled;
    rss.state = 'error';
    demoSnapshot.settings.emailEnabled = false;

    try {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: '切换到浅色模式' }));

      const online = screen.getByText('在线');
      const error = screen.getByText('采集异常');
      const disabled = screen.getByText('未启用');
      expect(error).toHaveClass('status-error');
      expect(disabled).toHaveClass('status-disabled');
      expect(online).not.toHaveClass('status-error');
      expect(online).not.toHaveClass('status-disabled');
    } finally {
      rss.state = originalState;
      demoSnapshot.settings.emailEnabled = originalEmailEnabled;
    }
  });
});
