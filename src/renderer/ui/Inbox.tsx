import { useState } from 'react';
import { ArrowLeft, Bell, Check, Copy, ExternalLink, FileText, Link2, RefreshCw, Search, X } from 'lucide-react';
import type { AppSnapshot, PostView } from '../../shared/api';
import { deliveryLabel, deliveryTone } from '../deliveryStatus';
import { Empty, FilterTabs, Note, PostRow, SignalIcon } from './components';
import { explanation, filteredPosts, fullDate, labels, levelOf, sourceName, type Filter } from './model';
interface Props { snapshot: AppSnapshot; selectedId: string | null; select: (id: string | null) => void; checking: boolean; onCheck: () => void; openPost: (url: string) => Promise<void>; notify: (text: string) => void }
export function Inbox({ snapshot, selectedId, select, checking, onCheck, openPost, notify }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const selected = snapshot.posts.find(item => item.post.id === selectedId);
  const items = filteredPosts(snapshot.posts, filter, query);
  return <><div className="page-heading"><div><h1>动态收件箱</h1></div><span className="quiet-text">原创、回复与引用 · 自动合并重复动态</span></div>
    <div className={`inbox-layout ${selected ? 'has-selection' : ''}`}><section className="inbox-list" aria-label="动态列表"><div className="search-wrap"><Search size={19}/><input aria-label="搜索动态" placeholder="搜索动态、关键词…" value={query} onChange={event => setQuery(event.target.value)}/>{query ? <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={16}/></button> : null}</div><FilterTabs posts={snapshot.posts} value={filter} onChange={setFilter}/><div className="feed-toolbar"><span>共 {items.length} 条记录</span><button className="text-button subtle" disabled={checking} onClick={onCheck}><RefreshCw size={16} className={checking ? 'spin' : ''}/>{checking ? '检查中…' : '刷新'}</button></div><div className="inbox-scroll">{items.length ? items.map(item => <PostRow key={item.post.id} item={item} compact selected={selectedId === item.post.id} onClick={() => select(item.post.id)}/>) : <Empty/>}</div></section>
      <section className="reader" aria-label="动态详情">{selected ? <Reader key={selected.post.id} item={selected} snapshot={snapshot} close={() => select(null)} openPost={openPost} notify={notify}/> : <Empty title={selectedId ? '这条动态暂未载入' : '选一条动态，慢慢看'}>左侧保留所有动态，右侧展示原文、判断说明与提醒记录。</Empty>}</section>
    </div></>;
}
function Reader({ item, snapshot, close, openPost, notify }: { item: PostView; snapshot: AppSnapshot; close: () => void; openPost: (url: string) => Promise<void>; notify: (text: string) => void }) {
  const [copied, setCopied] = useState(false);
  const deliveries = snapshot.deliveries.filter(delivery => delivery.postId === item.post.id);
  async function copy() { try { await navigator.clipboard.writeText(item.post.text); setCopied(true); notify('原文已复制'); } catch { notify('复制失败，可选中正文手动复制。'); } }
  return <><header className="reader-header"><div className="reader-level"><SignalIcon level={levelOf(item)}/><strong>{item.classification ? labels[levelOf(item)] : '待判断'}</strong></div><div className="reader-actions"><button className="icon-button mobile-back" aria-label="返回动态列表" onClick={close}><ArrowLeft size={20}/></button><button className="icon-button" aria-label="关闭详情" onClick={close}><X size={21}/></button></div></header>
    <div className="reader-scroll"><div className="author-line"><span className="avatar">T</span><strong>Tibo</strong><span>@{item.post.authorHandle}</span><span>·</span><time>{fullDate(item.post.createdAt)} 北京时间</time></div><blockquote aria-label="动态原文">{item.post.text}</blockquote>{item.post.quotedText ? <div className="quoted-original"><h3>引用原文</h3><p>{item.post.quotedText}</p></div> : null}<div className="reader-divider"/>
      <div className="detail-section"><FileText/><div><h3>判断说明</h3><p>{explanation(item)}</p></div></div>
      <div className="detail-section"><Link2/><div><h3>采集来源</h3><div className="source-pills">{item.post.sourceIds.map(id => <span key={id}>{sourceName(id)}</span>)}<small>{{ original: '原创', reply: '回复', quote: '引用' }[item.post.kind]}</small></div><p>{item.post.sourceIds.length > 1 ? '多个来源收录，已合并为同一条动态。' : '保留采集到的完整正文。'}</p></div></div>
      <div className="detail-section"><Bell/><div><h3>提醒记录</h3>{deliveries.length ? deliveries.map(row => <div className="delivery-mini" key={`${row.eventId}-${row.channel}`}><time>{fullDate(row.updatedAt)}</time><span>{row.channel === 'email' ? '邮件' : 'Windows'}</span><span className={`status ${deliveryTone(row) || 'online'}`}>{deliveryLabel(row)}</span></div>) : <p>无发送记录（历史基线或未触发提醒）</p>}<Note>SMTP 接受不代表邮件已进入收件箱。</Note></div></div>
    </div><div className="reader-bottom"><button className="button primary" onClick={() => void openPost(item.post.url)}><ExternalLink size={17}/>查看原帖</button><button className="button" onClick={() => void copy()}>{copied ? <Check size={17}/> : <Copy size={17}/>}{copied ? '已复制' : '复制原文'}</button></div></>;
}
