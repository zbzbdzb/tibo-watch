// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { App } from '../../src/renderer/App';

describe('App navigation and appearance controls', () => {
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
});
