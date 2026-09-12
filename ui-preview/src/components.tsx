import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ArrowRight, Check, ChevronRight, Clock3, Info, MessageSquareText, RefreshCw, X } from 'lucide-react';
import { levelLabels, posts, type Filter, type Level, type Post } from './data';

export function Mark({ large = false }: { large?: boolean }) {
  return <span className={`brand-mark ${large ? 'large' : ''}`} aria-hidden="true"><i/><b/></span>;
}
export function SignalIcon({ level }: { level: Level }) {
  const Icon = level === 'confirmed' ? Check : level === 'preview' ? Clock3 : MessageSquareText;
  return <span className={`signal-icon ${level}`}><Icon size={20} strokeWidth={1.8}/></span>;
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
export function FilterTabs({ value, onChange }: { value: Filter; onChange: (value: Filter) => void }) {
  const filters: [Filter, string][] = [['all', '全部'], ['confirmed', '确认'], ['preview', '预告'], ['related', '相关']];
  return <div className="filter-tabs" role="tablist" aria-label="动态分类">{filters.map(([key, label]) =>
    <button key={key} role="tab" aria-selected={value === key} onClick={() => onChange(key)}>{label}<span>{key === 'all' ? posts.length : posts.filter(p => p.level === key).length}</span></button>)}</div>;
}
export function PostRow({ post, selected = false, compact = false, onClick }: { post: Post; selected?: boolean; compact?: boolean; onClick: () => void }) {
  return <button className={`post-row ${selected ? 'selected' : ''} ${compact ? 'compact' : ''}`} onClick={onClick} aria-label={`阅读：${post.text}`} aria-current={selected ? 'true' : undefined}>
    <SignalIcon level={post.level}/><div className="post-copy"><div className="post-meta"><strong>{levelLabels[post.level]}</strong><span>·</span><time>{compact ? `${post.day.split(' ')[0]} ` : ''}{post.time}</time></div><p className="post-quote">{post.text}</p><p className="post-note">{post.note}</p></div><ChevronRight className="row-chevron" size={18}/>
  </button>;
}
export function Empty({ title = '没有找到匹配的动态', children }: { title?: string | undefined; children?: ReactNode }) {
  return <div className="empty"><MessageSquareText size={32}/><h3>{title}</h3><p>{children ?? '试试其他关键词，或切换上方的分类。'}</p></div>;
}
export function Note({ children }: { children: ReactNode }) { return <p className="note"><Info size={16}/><span>{children}</span></p>; }

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-header"><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭弹窗"><X size={20}/></button></div>{children}
  </dialog>;
}
