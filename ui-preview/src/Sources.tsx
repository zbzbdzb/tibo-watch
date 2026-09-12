import { Cable, ExternalLink, Globe2, Puzzle, Rss, ShieldCheck } from 'lucide-react';
import { CheckButton, Status, Toggle } from './components';
import type { Scenario } from './data';
import type { Preferences } from './state';

interface Props { prefs: Preferences; update: (patch: Partial<Preferences>) => void; checking: boolean; onCheck: () => void; scenario: Scenario; setup: () => void; notify: (message: string) => void }
export function Sources({ prefs, update, checking, onCheck, scenario, setup, notify }: Props) {
  const offline = scenario === 'outage';
  return <><div className="page-heading"><div><h1>数据源</h1></div><CheckButton checking={checking} onClick={onCheck} label="检查全部来源"/></div>
    <div className="source-overview"><Cable size={23}/><div><strong>{Number(prefs.chrome) + Number(prefs.rss)} 个来源已启用</strong><span>来源独立采集，同一条动态只保留一份。{checking ? '正在检查连接…' : '所有开关均即时保存。'}</span></div><span className="preview-label">连接状态为演示</span></div>
    <div className="source-cards">{(['chrome', 'rss'] as const).map(key => {
      const chrome = key === 'chrome'; const enabled = prefs[key]; const Icon = chrome ? Puzzle : Rss;
      return <section className="source-card" key={key}><div className="source-card-heading"><span className="source-logo"><Icon size={28}/></span><div><h2>{chrome ? 'Chrome 登录共享' : '公共 RSS'}</h2><p>{chrome ? '读取当前浏览器里的公开动态' : '无需登录的备用采集路径'}</p></div><Toggle label={chrome ? '启用 Chrome 登录共享' : '启用公共 RSS'} checked={enabled} onChange={() => { update({ [key]: !enabled }); notify(`${chrome ? 'Chrome 登录共享' : '公共 RSS'}已${enabled ? '停用' : '启用'} · 仅更改原型设置`); }}/></div>
        <div className="source-status-bar"><Status kind={!enabled ? 'disabled' : offline ? 'error' : checking ? 'warning' : 'online'}>{!enabled ? '已停用' : offline ? '连接待恢复' : checking ? '检查中' : '在线'}</Status><span>{!enabled ? '暂停此来源的采集' : offline ? '请检查网络与登录状态' : chrome ? '扩展已连接 · 0.2.16' : 'nitter.perennialte.ch'}</span></div>
        <dl className="source-facts"><div><dt>最近成功</dt><dd>{enabled && !offline ? '今天 17:12' : '—'}</dd></div><div><dt>{chrome ? '帖子页 / 回复页' : '请求方式'}</dt><dd>{chrome ? '采集完成 / 采集完成' : 'Windows 系统代理'}</dd></div><div><dt>{chrome ? '待补全正文' : '采集耗时'}</dt><dd>{chrome ? '0 条' : enabled && !offline ? '0.96 秒' : '—'}</dd></div></dl>
        <div className="source-guidance"><ShieldCheck size={18}/><p>{chrome ? '只读取可见的公开动态，不读取或导出 Cookie、密码、会话令牌。' : '独立于 Chrome 运行。公共实例可能延迟或失效，失败时会尝试其他候选来源。'}</p></div>
        <div className="source-card-actions">{chrome ? <button className="button" onClick={setup}><ExternalLink size={16}/>安装 / 重载扩展</button> : <button className="button" onClick={() => notify('当前演示实例：nitter.perennialte.ch；失败后将自动尝试其他来源。')}><Globe2 size={17}/>查看实例详情</button>}<CheckButton checking={checking} onClick={onCheck} label="检查连接"/></div>
      </section>;
    })}</div>
    
  </>;
}
