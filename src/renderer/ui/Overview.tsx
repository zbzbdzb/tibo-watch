import { useEffect, useState } from 'react';
import { Mail, Monitor, Pause, Play, Puzzle, Rss, TriangleAlert } from 'lucide-react';
import type { AppSnapshot, PostView } from '../../shared/api';
import { selectCurrentSignal } from '../currentSignal';
import { deliveryLabel, deliveryTone, latestDelivery } from '../deliveryStatus';
import { CheckButton, Empty, FilterTabs, LinkButton, Mark, PostRow, SourceStatus, Status } from './components';
import { filteredPosts, formatDay, formatTime, healthFor, type Filter, type PageId } from './model';
interface Props { snapshot: AppSnapshot; checking: boolean; busy: boolean; onCheck: () => void; onPause: () => void; navigate: (page: PageId) => void; onSelect: (post: PostView) => void }
export function Overview({ snapshot, checking, busy, onCheck, onPause, navigate, onSelect }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const current = selectCurrentSignal(snapshot.posts, Math.max(now, Date.parse(snapshot.lastCheckedAt ?? '') || 0));
  const level = current?.classification?.level;
  const sources = [healthFor(snapshot, 'x-browser'), healthFor(snapshot, 'public-rss')];
  const disabled = sources.every(source => source.state === 'disabled');
  const offline = !disabled && sources.every(source => !['online', 'syncing', 'partial'].includes(source.state));
  const title = snapshot.paused ? '暂时停下来，也没关系' : disabled ? '启用数据源，开始监测' : current ? level === 'confirmed' ? '新一轮重置，已宣布执行' : '下一次重置，已有预告' : offline ? '采集暂时中断，等待恢复' : '正在留意下一次重置';
  const subtitle = snapshot.paused ? '恢复后会继续检查；已有动态和通知记录都在。' : disabled ? '前往数据源页面，启用 Chrome 扩展或公共 RSS。' : current?.post.text ?? (offline ? '请检查数据源连接，已有记录仍然保留。' : '发现新的确认或预告时，会按你的通知设置提醒。');
  const items = filteredPosts(snapshot.posts, filter).slice(0, 30);
  const channels = [snapshot.settings.windowsConfirmedEnabled, snapshot.settings.windowsPreviewEnabled, snapshot.settings.windowsRelatedEnabled];
  const mail = latestDelivery(snapshot.deliveries, 'email');
  return <>
    <div className="page-heading"><div><h1>监测总览</h1></div><div className="heading-actions"><span className="calendar-date">{formatDay(new Date(now).toISOString())}</span><CheckButton checking={checking} onClick={onCheck}/></div></div>
    <section className={`monitor-banner ${snapshot.paused ? 'paused' : current ? level : offline || disabled ? 'outage' : 'monitoring'}`} aria-label="当前监测状态">
      <div className="monitor-symbol">{!current && (offline || disabled) ? <TriangleAlert size={46}/> : <Mark large/>}</div><div className="monitor-copy"><span className="monitor-label">{snapshot.paused ? '监测已暂停' : current ? level === 'confirmed' ? '已确认重置' : '重置预告' : disabled ? '未启用数据源' : offline ? '需要留意' : '监测中'}</span><h2>{title}</h2><p title={subtitle}>{subtitle}</p><div className="monitor-times"><span>最近检查 <time>{formatTime(snapshot.lastCheckedAt)}</time></span><span>下次检查 {snapshot.paused ? '已暂停' : formatTime(snapshot.nextCheckAt)}</span><span>每 {snapshot.settings.pollIntervalMinutes} 分钟</span>{current ? <button className="text-button" onClick={() => onSelect(current)}>查看公告</button> : null}</div></div><button className="button banner-action" disabled={busy} onClick={onPause}>{snapshot.paused ? <Play size={17}/> : <Pause size={17}/>}{snapshot.paused ? '恢复监测' : '暂停监测'}</button>
    </section>
    <div className="overview-columns"><section className="recent-feed"><div className="section-heading"><h2>最近动态</h2><LinkButton onClick={() => navigate('inbox')}>查看全部</LinkButton></div><FilterTabs posts={snapshot.posts} value={filter} onChange={setFilter}/><div className="overview-feed-scroll">{items.length ? items.map((item, index) => <div key={item.post.id}>{formatDay(items[index - 1]?.post.createdAt ?? null) !== formatDay(item.post.createdAt) ? <div className="date-group">{formatDay(item.post.createdAt)}</div> : null}<PostRow item={item} onClick={() => onSelect(item)}/></div>) : <Empty title="还没有匹配的动态">新动态会在采集后显示在这里。</Empty>}</div></section>
      <aside className="overview-aside"><section className="health-panel"><h2>连接与送达</h2>{sources.map((source, index) => <button className="health-line" key={source.sourceId} onClick={() => navigate('sources')}>{index === 0 ? <Puzzle/> : <Rss/>}<span>{index === 0 ? 'Chrome 扩展' : '公共 RSS'}</span><SourceStatus state={source.state} errorCode={source.errorCode}/></button>)}
        <button className="health-line" onClick={() => navigate('notifications')}><Monitor/><span>Windows 通知</span><Status kind={!snapshot.windowsNotificationsSupported || !channels.some(Boolean) ? 'disabled' : 'online'}>{!snapshot.windowsNotificationsSupported ? '系统不支持' : channels.every(Boolean) ? '已启用' : channels.some(Boolean) ? '部分启用' : '已停用'}</Status></button>
        <button className="health-line mail-health" onClick={() => navigate('notifications')}><Mail/><span>邮件提醒</span><span className={`status ${snapshot.settings.emailEnabled ? deliveryTone(mail) || 'online' : 'status-disabled'}`} title={deliveryLabel(mail)}><i/>{!snapshot.settings.emailEnabled ? '未启用' : !mail ? '未发送' : mail.state === 'submitted' ? 'SMTP 已接受' : mail.state === 'failed' || mail.state === 'partial' ? '发送异常' : '等待处理'}</span></button><LinkButton onClick={() => navigate('sources')}>查看详细状态</LinkButton>
      </section></aside>
    </div>
  </>;
}
