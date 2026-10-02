// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { Inbox } from '../../src/renderer/ui/Inbox';
import { demoSnapshot } from '../../src/renderer/demoData';
import type { AppSnapshot } from '../../src/shared/api';

const storageKey = 'tibo-watch-announcement-zone-v1';
function fixture(text = 'Global reset landing tomorrow 10am PST for all paid ChatGPT accounts.', createdAt = '2026-10-02T02:14:00.000Z'): AppSnapshot {
  const snapshot = structuredClone(demoSnapshot);
  const item = snapshot.posts[0]!;
  item.post.text = text;
  item.post.createdAt = createdAt;
  item.classification!.level = 'preview';
  snapshot.posts = [item, { ...structuredClone(item), post: { ...item.post, id: 'second-preview', text: 'Reset will land tomorrow at 2pm PT.' } }];
  return snapshot;
}
function Harness({ snapshot }: { snapshot: AppSnapshot }) {
  const [selected, select] = useState<string | null>(snapshot.posts[0]!.post.id);
  return <Inbox snapshot={snapshot} selectedId={selected} select={select} checking={false} onCheck={() => {}} openPost={async () => {}} notify={() => {}}/>;
}
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('shows the original PST source clock and selectable target time without changing the original', () => {
  const snapshot = fixture();
  render(<Harness snapshot={snapshot}/>);
  const card = within(screen.getByRole('region', { name: '预告时间' }));
  expect(card.getByLabelText('预告目标时区')).toHaveValue('Asia/Shanghai');
  expect(card.getByLabelText('预告时间换算')).toHaveTextContent('2026-10-03 02:00');
  expect(card.getByText('2026-10-02 10:00')).toBeVisible();
  expect(card.getByText('PST · UTC−08:00')).toBeVisible();
  expect(card.queryByText('2026-10-02 11:00')).not.toBeInTheDocument();
  expect(card.getByText(/按原文 PST/)).toBeVisible();
  fireEvent.change(card.getByLabelText('预告目标时区'), { target: { value: 'America/New_York' } });
  expect(card.getByLabelText('预告时间换算')).toHaveTextContent('2026-10-02 14:00');
  expect(card.getByLabelText('预告时间换算')).toHaveTextContent('EDT');
  expect(screen.getByLabelText('动态原文')).toHaveTextContent(snapshot.posts[0]!.post.text);
});

it('defaults an unmarked preview to PST and clearly labels the assumption', () => {
  render(<Harness snapshot={fixture('Reset landing tomorrow 10am.')}/>);
  const card = within(screen.getByRole('region', { name: '预告时间' }));
  expect(card.getByText('2026-10-02 10:00')).toBeVisible();
  expect(card.getByLabelText('预告时间换算')).toHaveTextContent('2026-10-03 02:00');
  expect(card.getByText(/原文未注明时区，默认按 PST/)).toBeVisible();
});

it('preserves an explicit PDT source clock rather than silently applying the PST default', () => {
  render(<Harness snapshot={fixture('Reset landing tomorrow 10am PDT.')}/>);
  const card = within(screen.getByRole('region', { name: '预告时间' }));
  expect(card.getByText('2026-10-02 10:00')).toBeVisible();
  expect(card.getByText('PDT · UTC−07:00')).toBeVisible();
  expect(card.getByLabelText('预告时间换算')).toHaveTextContent('2026-10-03 01:00');
});

it('retains target selection when reading another preview and remounting the app', () => {
  const snapshot = fixture();
  render(<Harness snapshot={snapshot}/>);
  fireEvent.change(screen.getByLabelText('预告目标时区'), { target: { value: 'Asia/Tokyo' } });
  fireEvent.click(screen.getByRole('button', { name: /Reset will land tomorrow at 2pm PT/ }));
  expect(screen.getByLabelText('预告目标时区')).toHaveValue('Asia/Tokyo');
  expect(screen.getByLabelText('预告时间换算')).toHaveTextContent('2026-10-03 06:00');
  cleanup();
  render(<Harness snapshot={snapshot}/>);
  expect(screen.getByLabelText('预告目标时区')).toHaveValue('Asia/Tokyo');
  expect(screen.getByLabelText('预告时间换算')).toHaveTextContent('2026-10-03 03:00');
});

it('keeps date-only previews imprecise instead of inventing midnight', () => {
  render(<Harness snapshot={fixture('Codex reset will land tomorrow.')}/>);
  expect(screen.getByRole('region', { name: '预告时间' })).toHaveTextContent('2026-10-02');
  expect(screen.getByLabelText('预告时间换算')).toHaveTextContent('未提供具体时间');
  expect(screen.getByLabelText('预告时间换算')).not.toHaveTextContent('00:00');
});

it('requires a choice for a repeated Pacific hour and does not choose an instant silently', () => {
  render(<Harness snapshot={fixture('Reset will land on November 1, 2026 at 1:30am PT.')}/>);
  const result = screen.getByLabelText('预告时间换算');
  expect(result).toHaveTextContent('选择具体时刻');
  expect(result).not.toHaveTextContent('16:30');
  fireEvent.change(screen.getByLabelText('预告重复时间的具体时刻'), { target: { value: '1' } });
  expect(result).toHaveTextContent('2026-11-01 17:30');
});

it('reports nonexistent Pacific clocks without producing a shifted target time', () => {
  render(<Harness snapshot={fixture('Reset will land on March 8, 2026 at 2:30am PT.')}/>);
  expect(screen.getByLabelText('预告时间换算')).toHaveTextContent('不存在');
  expect(screen.getByLabelText('预告时间换算')).not.toHaveTextContent('18:30');
});

it('does not attach unrelated update times or quoted author times to the reset preview', () => {
  const snapshot = fixture('A reset is coming. The editor will launch tomorrow at 10am PT.');
  snapshot.posts[0]!.post.quotedText = 'Reset tomorrow 2pm PT.';
  render(<Harness snapshot={snapshot}/>);
  expect(screen.queryByRole('region', { name: '预告时间' })).not.toBeInTheDocument();
});

it('does not show a preview card for confirmed announcements and safely ignores obsolete timezone preferences', () => {
  localStorage.setItem(storageKey, 'Not/AZone');
  const snapshot = fixture();
  snapshot.posts[0]!.classification!.level = 'confirmed';
  render(<Harness snapshot={snapshot}/>);
  expect(screen.queryByRole('region', { name: '预告时间' })).not.toBeInTheDocument();
  cleanup();
  render(<Harness snapshot={fixture()}/>);
  expect(screen.getByLabelText('预告目标时区')).toHaveValue('Asia/Shanghai');
});

it('discards a fold selection when the same post receives a different announcement time', () => {
  const snapshot = fixture('Reset will land on November 1, 2026 at 1:30am PT.');
  const view = render(<Harness snapshot={snapshot}/>);
  fireEvent.change(screen.getByLabelText('预告重复时间的具体时刻'), { target: { value: '1' } });
  expect(screen.getByLabelText('预告时间换算')).toHaveTextContent('2026-11-01 17:30');
  const changed = structuredClone(snapshot);
  changed.posts[0]!.post.text = 'Reset will land on November 1, 2026 at 1:15am PT.';
  view.rerender(<Harness snapshot={changed}/>);
  expect(screen.getByLabelText('预告重复时间的具体时刻')).toHaveValue('');
  expect(screen.getByLabelText('预告时间换算')).toHaveTextContent('选择具体时刻');
  const confirmed = structuredClone(changed);
  confirmed.posts[0]!.classification!.level = 'confirmed';
  view.rerender(<Harness snapshot={confirmed}/>);
  expect(screen.queryByRole('region', { name: '预告时间' })).not.toBeInTheDocument();
});

it('recalculates relative dates when the post timestamp is corrected instead of keeping a stale converted result', () => {
  const snapshot = fixture('Reset landing tomorrow 10am PT.');
  const view = render(<Harness snapshot={snapshot}/>);
  expect(screen.getByLabelText('预告时间换算')).toHaveTextContent('2026-10-03 01:00');
  const changed = structuredClone(snapshot);
  changed.posts[0]!.post.createdAt = '2026-10-03T02:14:00.000Z';
  view.rerender(<Harness snapshot={changed}/>);
  expect(screen.getByLabelText('预告时间换算')).toHaveTextContent('2026-10-04 01:00');
});

it('allows conversion when browser preference storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage disabled'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
  render(<Harness snapshot={fixture()}/>);
  expect(screen.getByLabelText('预告目标时区')).toHaveValue('Asia/Shanghai');
  fireEvent.change(screen.getByLabelText('预告目标时区'), { target: { value: 'Asia/Tokyo' } });
  expect(screen.getByLabelText('预告目标时区')).toHaveValue('Asia/Tokyo');
  expect(screen.getByLabelText('预告时间换算')).toHaveTextContent('2026-10-03 03:00');
});

it('does not label an unsupported explicit source timezone as Pacific', () => {
  render(<Harness snapshot={fixture('Reset landing tomorrow 10am EST.')}/>);
  const card = screen.getByRole('region', { name: '预告时间' });
  expect(card).toHaveTextContent('原文时间（待确认）');
  expect(card.querySelector('.announcement-pacific')).not.toHaveTextContent('PT');
  expect(screen.getByLabelText('预告时间换算')).not.toHaveTextContent('2026-10-03');
});

it('marks approximate announced times as approximate in the converted display', () => {
  render(<Harness snapshot={fixture('Reset will land in ~ 3 hours.', '2026-09-03T23:12:09.000Z')}/>);
  expect(screen.getByLabelText('预告时间换算')).toHaveTextContent('约 2026-09-04 10:12');
  expect(screen.getByRole('region', { name: '预告时间' })).toHaveTextContent('原文时间为估计值');
});

it('does not mark a definite clock as approximate merely because nearby text says about an unrelated issue', () => {
  render(<Harness snapshot={fixture('Reset tomorrow 10am PT, sorry about the delays.')}/>);
  expect(screen.getByLabelText('预告时间换算')).toHaveTextContent('2026-10-03 01:00');
  expect(screen.getByLabelText('预告时间换算')).not.toHaveTextContent('约 ');
});
