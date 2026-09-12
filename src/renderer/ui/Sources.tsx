import { Cable, ExternalLink, Puzzle, Rss, ShieldCheck } from 'lucide-react';
import type { AppSnapshot } from '../../shared/api';
import { collectionReason, sourceStatus } from '../sourceStatus';
import { CheckButton, SourceStatus, Toggle } from './components';
import { fullDate, healthFor, type SaveSettings } from './model';
export function Sources({ snapshot, save, busy, checking, check, setup }: { snapshot: AppSnapshot; save: SaveSettings; busy: boolean; checking: boolean; check: () => void; setup: () => void }) {
  const sources = [healthFor(snapshot, 'x-browser'), healthFor(snapshot, 'public-rss')];
  return <><div className="page-heading"><div><h1>数据源</h1></div><CheckButton checking={checking} onClick={check} label="检查全部来源"/></div>
    <div className="source-overview"><Cable size={23}/><div><strong>{Number(snapshot.settings.browserSourceEnabled) + Number(snapshot.settings.publicRssEnabled)} 个来源已启用</strong><span>来源独立采集，同一条动态只保留一份。开关即时保存。</span></div></div>
    <div className="source-cards">{sources.map(source => {
      const chrome = source.sourceId === 'x-browser', key = chrome ? 'browserSourceEnabled' : 'publicRssEnabled';
      const enabled = snapshot.settings[key];
      const status = sourceStatus(source.state, source.errorCode);
      return <section className="source-card" key={source.sourceId}><div className="source-card-heading"><span className="source-logo">{chrome ? <Puzzle size={28}/> : <Rss size={28}/>}</span><div><h2>{chrome ? 'Chrome 登录共享' : '公共 RSS'}</h2><p>{chrome ? '读取当前浏览器里的公开动态' : '无需登录的备用采集路径'}</p></div><Toggle label={chrome ? '启用 Chrome 登录共享' : '启用公共 RSS'} checked={enabled} disabled={busy} onChange={() => void save({ [key]: !enabled })}/></div>
        <div className="source-status-bar"><SourceStatus state={source.state} errorCode={source.errorCode}/><span>{status.description}</span></div>
        <dl className="source-facts"><div><dt>最近检查</dt><dd>{fullDate(source.lastCheckedAt)}</dd></div><div><dt>最近成功</dt><dd>{fullDate(source.lastSuccessAt)}</dd></div><div><dt>连续失败</dt><dd>{source.consecutiveFailures} 次</dd></div>{source.errorCode ? <div><dt>诊断代码</dt><dd>{source.errorCode}</dd></div> : null}</dl>
        {chrome && source.collectionDiagnostics?.length ? <div className="collection-diagnostics">{source.collectionDiagnostics.map(item => <div key={item.view}><h3>{item.view === 'posts' ? '帖子页' : '回复页'}</h3><p>{collectionReason(item.reason)}</p><small>运行扩展：{item.extensionVersion ?? '未知'} · 采集器：{item.collectorRevision ?? '未知'}</small><p>收录 {item.postCount} 条 · 待补全 {item.pendingDetails} 条</p><small>最近报告 {fullDate(item.receivedAt)}</small></div>)}</div> : null}
        <div className="source-guidance"><ShieldCheck size={18}/><p>{chrome ? '只读取可见的公开动态，不读取或复制 Cookie、密码、会话令牌。' : '通过系统网络配置访问公共实例。实例可能延迟或失效，失败后会尝试其他来源。'}</p></div>
        <div className="source-card-actions">{chrome ? <button className="button" disabled={busy} onClick={setup}><ExternalLink size={16}/>安装 / 重载扩展</button> : null}<CheckButton checking={checking} onClick={check} label="检查连接"/></div>
      </section>;
    })}</div></>;
}
