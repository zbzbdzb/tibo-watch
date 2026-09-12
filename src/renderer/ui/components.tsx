import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ArrowRight, Check, ChevronRight, Clock3, Info, MessageSquareText, RefreshCw, X } from 'lucide-react';
import type { PostView } from '../../shared/api';
import type { SignalLevel } from '../../shared/domain';
import { labels as levelLabels, levelOf, formatDay, formatTime, type Filter } from './model';
import { sourceStatus } from '../sourceStatus';

export function Mark({ large = false }: { large?: boolean }) {
  return <span className={`brand-mark ${large ? 'large' : ''}`} aria-hidden="true"><i/><b/></span>;
}
export function SignalIcon({ level }: { level: SignalLevel }) {
  const Icon = level === 'confirmed' ? Check : level === 'preview' ? Clock3 : MessageSquareText;
  return <span className={`signal-icon ${level === 'irrelevant' ? 'related' : level}`}><Icon size={20} strokeWidth={1.8}/></span>;
}
export function Status({ kind = 'online', children }: { kind?: 'online' | 'warning' | 'error' | 'disabled'; children: ReactNode }) {
  return <span className={`status ${kind}`}><i/>{children}</span>;
}
export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return <button className="toggle" type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={onChange}><span/></button>;
}
export function CheckButton({ checking, onClick, label = '立即检查' }: { checking: boolean; onClick: () => void; label?: string }) {
  return <button className="button" disabled={checking} onClick={onClick}><RefreshCw size={18} className={checking ? 'spin' : ''}/>{checking ? '正在检查…' : label}</button>;
}
export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button className="text-button" onClick={onClick}>{children}<ArrowRight size={17}/></button>;
}
export function FilterTabs({ posts, value, onChange }: { posts: PostView[]; value: Filter; onChange: (value: Filter) => void }) {
  const filters: [Filter, string][] = [['all', '全部'], ['confirmed', '确认'], ['preview', '预告'], ['related', '相关']];
  return <div className="filter-tabs" role="tablist" aria-label="动态分类">{filters.map(([key, label]) =>
    <button key={key} role="tab" aria-selected={value === key} onClick={() => onChange(key)}>{label}<span>{key === 'all' ? posts.length : posts.filter(p => levelOf(p) === key).length}</span></button>)}</div>;
}
export function PostRow({ item, selected = false, compact = false, onClick }: { item: PostView; selected?: boolean; compact?: boolean; onClick: () => void }) {
  const { post } = item;
  const level = levelOf(item);
  return <button className={`post-row ${selected ? 'selected' : ''} ${compact ? 'compact' : ''}`} onClick={onClick} aria-label={`阅读：${post.text}`} aria-current={selected ? 'true' : undefined}>
    <SignalIcon level={level}/><div className="post-copy"><div className="post-meta"><strong>{item.classification ? levelLabels[level] : '待判断'}</strong><span>·</span><time>{compact ? formatDay(post.createdAt) + ' ' : ''}{formatTime(post.createdAt)}</time></div><p className="post-quote">{post.text}</p><p className="post-note">Tibo · @{post.authorHandle} · {({ original: '原创', reply: '回复', quote: '引用' })[post.kind]}</p></div><ChevronRight className="row-chevron" size={18}/>
  </button>;
}
export function Empty({ title = '没有找到匹配的动态', children }: { title?: string | undefined; children?: ReactNode }) {
  return <div className="empty"><MessageSquareText size={32}/><h3>{title}</h3><p>{children ?? '试试其他关键词，或切换上方的分类。'}</p></div>;
}
export function Note({ children }: { children: ReactNode }) { return <p className="note"><Info size={16}/><span>{children}</span></p>; }

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const dialog = ref.current; if (dialog?.showModal) dialog.showModal(); else dialog?.setAttribute('open', ''); return () => { if (dialog?.close) dialog.close(); }; }, []);
  return <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-header"><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭弹窗"><X size={20}/></button></div>{children}
  </dialog>;
}
export function SourceStatus({ state, errorCode }: { state: string; errorCode?: string | null }) {
 const status = sourceStatus(state, errorCode);
 return <span className={`status ${status.tone || 'online'}`} title={status.description}><i/>{status.label}</span>;
}

