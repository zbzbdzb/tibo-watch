import { useState } from 'react';
import { ArrowLeft, Bell, Check, Copy, ExternalLink, FileText, Link2, Puzzle, RefreshCw, Rss, Search, X } from 'lucide-react';
import { Empty, FilterTabs, Note, PostRow, SignalIcon, Status } from './components';
import { levelLabels, posts, type Filter, type Post } from './data';

interface Props { selected: Post | null; onSelect: (post: Post | null) => void; notify: (message: string) => void; checking: boolean; onCheck: () => void; showSource: () => void }
export function Inbox({ selected, onSelect, notify, checking, onCheck, showSource }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const filtered = posts.filter(post => (filter === 'all' || post.level === filter) && `${post.text} ${post.note} ${post.reason}`.toLowerCase().includes(query.toLowerCase().trim()));
  async function copyText() {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.text); setCopied(true); window.setTimeout(() => setCopied(false), 1800); notify('原文已复制'); }
    catch { notify('浏览器未允许复制，可直接选中原文复制'); }
  }
  return <><div className="page-heading"><div><h1>动态收件箱</h1></div><span className="quiet-text">原创、回复与引用 · 自动合并重复动态</span></div>
    <div className={`inbox-layout ${selected ? 'has-selection' : ''}`}><section className="inbox-list" aria-label="动态列表"><div className="search-wrap"><Search size={19}/><input aria-label="搜索动态" placeholder="搜索动态、关键词…" value={query} onChange={event => setQuery(event.target.value)}/>{query ? <button className="icon-button" onClick={() => setQuery('')} aria-label="清空搜索"><X size={16}/></button> : null}</div><FilterTabs value={filter} onChange={setFilter}/><div className="feed-toolbar"><span>{filtered.length} 条动态</span><button className="text-button subtle" disabled={checking} onClick={onCheck}><RefreshCw className={checking ? 'spin' : ''} size={16}/>{checking ? '检查中…' : '刷新'}</button></div><div className="inbox-scroll">{filtered.length ? filtered.map(post => <PostRow key={post.id} post={post} selected={post.id === selected?.id} compact onClick={() => onSelect(post)}/>) : <Empty/>}</div></section>
      <section className="reader" aria-label="动态详情">{selected ? <>
        <header className="reader-header"><div className="reader-level"><SignalIcon level={selected.level}/><strong>{levelLabels[selected.level]}</strong></div><div className="reader-actions"><button className="icon-button mobile-back" aria-label="返回动态列表" onClick={() => onSelect(null)}><ArrowLeft size={20}/></button><button className="icon-button" onClick={() => onSelect(null)} aria-label="关闭详情"><X size={21}/></button></div></header>
        <div className="reader-scroll" key={selected.id}><div className="author-line"><span className="avatar">T</span><strong>Tibo</strong><span>@thsottiaux</span><span>·</span><time>{selected.day.split(' ')[0]} {selected.time}</time><span>· 北京时间</span></div><blockquote>{selected.text}</blockquote><p className="reader-translation">{selected.note}</p><div className="reader-divider"/>
          <div className="detail-section"><FileText/><div><h3>判断说明</h3><p>{selected.reason}</p></div></div>
          <div className="detail-section"><Link2/><div><h3>采集来源</h3><div className="source-pills"><span><Puzzle size={16}/>Chrome 扩展</span><span><Rss size={16}/>公共 RSS</span><small>{selected.kind}</small></div><p>双来源收录，已合并为同一条动态。</p></div></div>
          <div className="detail-section"><Bell/><div><h3>提醒记录</h3>{selected.delivered ? <><div className="delivery-mini"><span>{selected.time}</span><span>Windows 通知</span><Status>已送达</Status></div><div className="delivery-mini"><span>{selected.time}</span><span>邮件提醒</span><Status>SMTP 已接受</Status></div><Note>SMTP 接受不代表邮件已进入收件箱。</Note></> : <p>此条相关动态未触发邮件；可在通知设置中调整。</p>}</div></div>
        </div><div className="reader-bottom"><button className="button primary" onClick={showSource}><ExternalLink size={17}/>查看来源</button><button className="button" onClick={() => void copyText()}>{copied ? <Check size={17}/> : <Copy size={17}/>} {copied ? '已复制' : '复制原文'}</button></div></> : <Empty title="选一条动态，慢慢看">左侧保留所有动态，右侧展示原文、判断说明与提醒记录。</Empty>}</section>
    </div>
  </>;
}
