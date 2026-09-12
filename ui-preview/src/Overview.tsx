import { useState } from 'react';
import { Mail, Monitor, Pause, Play, Puzzle, Rss, ShieldCheck, TriangleAlert } from 'lucide-react';
import { CheckButton, FilterTabs, LinkButton, Mark, PostRow, Status } from './components';
import { posts, type Filter, type PageId, type Post, type Scenario } from './data';
import type { Preferences } from './state';

interface Props {
  prefs: Preferences; paused: boolean; onPause: () => void; scenario: Scenario; checkedAt: string;
  onNavigate: (page: PageId) => void; onSelect: (post: Post) => void; checking: boolean; onCheck: () => void;
}
export function Overview({ prefs, paused, onPause, scenario, checkedAt, onNavigate, onSelect, checking, onCheck }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const filtered = posts.filter(p => filter === 'all' || p.level === filter).slice(0, 4);
  const offline = scenario === 'outage' || (!prefs.chrome && !prefs.rss);
  const [hours, minutes] = checkedAt.split(':').map(Number);
  const nextMinutes = (hours! * 60 + minutes! + Number(prefs.interval)) % (24 * 60);
  const nextCheck = `${String(Math.floor(nextMinutes / 60)).padStart(2, '0')}:${String(nextMinutes % 60).padStart(2, '0')}`;
  const title = paused ? '暂时停下来，也没关系' : offline ? '采集暂时中断，等待恢复' : scenario === 'confirmed' ? '新一轮重置，已宣布执行' : scenario === 'preview' ? '下一次重置，已有预告' : '正在留意下一次重置';
  const subtitle = paused ? '恢复后会继续检查；已有动态和通知记录都在。' : offline ? '请检查数据源连接。恢复后将继续采集，不会丢失已有记录。' : scenario === 'confirmed' ? '这是公告状态，不代表你的个人额度已经到账。12 小时后自动回到监测中。' : scenario === 'preview' ? 'Reset will land around 14pm PST tomorrow. 预告会在 36 小时后自动到期。' : '发现新的确认或预告时，我们会第一时间通知你。';
  return <>
    <div className="page-heading"><div><h1>监测总览</h1></div><div className="heading-actions"><span className="calendar-date">9月12日，星期六</span><CheckButton checking={checking} onClick={onCheck}/></div></div>
    <section className={`monitor-banner ${paused ? 'paused' : offline ? 'outage' : scenario}`} aria-label="当前监测状态">
      <div className="monitor-symbol">{offline ? <TriangleAlert size={46} strokeWidth={1.3}/> : <Mark large/>}</div>
      <div className="monitor-copy"><span className="monitor-label">{paused ? '监测已暂停' : offline ? '需要留意' : scenario === 'confirmed' ? '已确认重置' : scenario === 'preview' ? '重置预告' : '监测进行中'}</span><h2>{title}</h2><p>{subtitle}</p><div className="monitor-times"><span>最近检查 <time>{checkedAt}</time></span><span>下次检查 {paused ? '已暂停' : nextCheck}</span><span>每 {prefs.interval} 分钟</span></div></div>
      <button className="button banner-action" onClick={onPause}>{paused ? <Play size={17}/> : <Pause size={17}/>} {paused ? '恢复监测' : '暂停监测'}</button>
    </section>
    <div className="overview-columns"><section className="recent-feed"><div className="section-heading"><h2>最近动态</h2><LinkButton onClick={() => onNavigate('inbox')}>查看全部</LinkButton></div><FilterTabs value={filter} onChange={setFilter}/><div className="overview-feed-scroll">{filtered.map((post, index) => <div key={post.id}>{filtered[index - 1]?.day !== post.day ? <div className="date-group">{post.day}</div> : null}<PostRow post={post} onClick={() => onSelect(post)}/></div>)}</div></section>
      <aside className="overview-aside"><section className="health-panel"><h2>连接与送达</h2>
        <button className="health-line" onClick={() => onNavigate('sources')}><Puzzle/><span>Chrome 扩展</span><Status kind={!prefs.chrome ? 'disabled' : offline ? 'error' : 'online'}>{!prefs.chrome ? '已停用' : offline ? '待恢复' : '在线'}</Status></button>
        <button className="health-line" onClick={() => onNavigate('sources')}><Rss/><span>公共 RSS</span><Status kind={!prefs.rss ? 'disabled' : offline ? 'error' : 'online'}>{!prefs.rss ? '已停用' : offline ? '待恢复' : '在线'}</Status></button>
        <button className="health-line" onClick={() => onNavigate('notifications')}><Monitor/><span>Windows 通知</span><Status kind={Object.values(prefs.channels).some(Boolean) ? 'online' : 'disabled'}>{Object.values(prefs.channels).some(Boolean) ? '已启用' : '已停用'}</Status></button>
        <button className="health-line" onClick={() => onNavigate('notifications')}><Mail/><span>邮件提醒</span><Status kind={prefs.mail ? 'online' : 'disabled'}>{prefs.mail ? '已启用' : '已停用'}</Status></button>
        <LinkButton onClick={() => onNavigate('sources')}>管理数据源</LinkButton>
      </section><div className="privacy-note"><ShieldCheck size={25}/><div><strong>在你的设备上运行</strong><p>一切判定都在本地完成。</p></div></div></aside>
    </div>
  </>;
}
