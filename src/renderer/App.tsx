import { Check, CircleHelp, Minus, Moon, Square, Sun, X } from 'lucide-react';
import { useState } from 'react';
import { Mark, Modal, Note } from './ui/components';
import { useApplication } from './ui/useApplication';
import type { PageId } from './ui/model';
import { Overview } from './ui/Overview';
import { Inbox } from './ui/Inbox';
import { Sources } from './ui/Sources';
import { Notifications } from './ui/Notifications';
import { Settings } from './ui/Settings';

const navigation: [PageId, string][] = [['overview', '总览'], ['inbox', '动态收件箱'], ['sources', '数据源'], ['notifications', '通知'], ['settings', '设置']];
export function App() {
  const app = useApplication();
  const { api, snapshot, loaded, loadError, page, navigate, selectedId, select, theme, setTheme, message, notify, busy, checking, save, action, check, openPost, pause } = app;
  const [help, setHelp] = useState(false);
  const goto = (next: PageId) => { if (next === 'inbox' && selectedId === null) select(snapshot.posts[0]?.post.id ?? null); navigate(next); };
  const setup = async () => { if (api) await action(() => api.openXLogin(), '已打开扩展安装位置和 Chrome 扩展页'); else notify('请在桌面应用中打开扩展设置'); };
  return <div className="app" data-theme={theme}>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳到主内容</a>
    <header className={`app-header ${api ? 'desktop-header' : ''}`}><div className="header-inner"><button className="wordmark" aria-label="Tibo Watch 总览" onClick={() => goto('overview')}><Mark/><span>Tibo Watch</span></button><nav className="main-nav" aria-label="主导航">{navigation.map(([id,label]) => <button key={id} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => goto(id)}>{label}</button>)}</nav><div className="header-tools"><button className="icon-button" aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={23}/> : <Moon size={23}/>}</button><button className="icon-button help-button" aria-label="使用说明" onClick={() => setHelp(true)}><CircleHelp size={20}/></button>{api ? <div className="window-actions">{(['minimize','maximize','close'] as const).map((value,index) => <button className="icon-button" key={value} aria-label={['最小化','最大化','关闭'][index]} onClick={() => void api.windowAction(value).catch(() => notify('窗口操作失败，请重试'))}>{value === 'minimize' ? <Minus size={17}/> : value === 'maximize' ? <Square size={15}/> : <X size={18}/>}</button>)}</div> : null}</div></div></header>
    <main id="main-content" tabIndex={-1} className={`app-main page-${page}`}>
      {!loaded ? <div className="empty"><h1>{loadError ? '无法加载监测状态' : '正在加载监测状态…'}</h1>{loadError ? <button className="button" onClick={() => window.location.reload()}>重新加载</button> : null}</div> : <>
        <div className="page-view" hidden={page !== 'overview'}><Overview snapshot={snapshot} checking={checking} busy={busy} onCheck={() => void check()} onPause={() => void pause()} navigate={goto} onSelect={item => { select(item.post.id); navigate('inbox'); }}/></div>
        <div className="page-view" hidden={page !== 'inbox'}><Inbox snapshot={snapshot} selectedId={selectedId} select={select} checking={checking} onCheck={() => void check()} openPost={openPost} notify={notify}/></div>
        <div className="page-view" hidden={page !== 'sources'}><Sources snapshot={snapshot} save={save} busy={busy} checking={checking} check={() => void check()} setup={() => void setup()}/></div>
        <div className="page-view" hidden={page !== 'notifications'}><Notifications snapshot={snapshot} save={save} busy={busy} notify={notify} retry={id => api ? action(() => api.retryMail(id), '重试已处理，请查看送达结果') : Promise.resolve(false)}/></div>
        <div className="page-view" hidden={page !== 'settings'}><Settings settings={snapshot.settings} save={save} busy={busy} theme={theme} setTheme={setTheme}/></div>
      </>}
    </main>
    <footer className="app-footer"><span><i/>{!api ? '浏览器演示 · 不连接真实账号' : snapshot.paused ? '监测已暂停' : !snapshot.settings.browserSourceEnabled && !snapshot.settings.publicRssEnabled ? '未启用数据源' : '后台监测中'} · 每 {snapshot.settings.pollIntervalMinutes} 分钟检查</span>{snapshot.lastCheckError ? <button className="text-button status-error" onClick={() => goto('sources')}>检查未完成 · 查看详情</button> : null}<span>版本 {snapshot.version} · 北京时间 UTC+8</span></footer>
    {message ? <div className="toast" role="status"><Check size={18}/><span>{message}</span><button className="icon-button" aria-label="关闭提示" onClick={() => notify('')}><X size={17}/></button></div> : null}
    {help ? <Modal title="使用 Tibo Watch" onClose={() => setHelp(false)}><div className="help-steps"><p><span>01</span>总览查看当前公告和采集状态，点击动态进入完整原文。</p><p><span>02</span>数据源中安装或重载 Chrome 扩展，查看帖子页与回复页诊断。</p><p><span>03</span>通知中分别设置 Windows、声音和邮件，查看逐渠道送达记录。</p><p><span>04</span>设置开机自启后将静默进入托盘，关闭窗口行为可单独调整。</p></div><button className="button primary" onClick={() => setHelp(false)}>明白了</button></Modal> : null}
    {api && loaded && !snapshot.settings.onboardingComplete ? <Modal title="开始监测 Codex 重置" onClose={() => {}}><p>首先采集已有动态，建立历史基线。首次同步不会发送历史提醒。</p><Note>采集来源与通知方式可以稍后调整。已有记录会保留。</Note><div className="modal-actions"><button className="button primary" disabled={busy} onClick={() => void action(() => api.completeOnboarding(), '历史基线已建立')}>{busy ? '正在建立基线…' : '建立历史基线并开始'}</button></div></Modal> : null}
  </div>;
}
