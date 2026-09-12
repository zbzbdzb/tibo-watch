import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CircleHelp, ExternalLink, Moon, Sun, X } from 'lucide-react';
import { Mark, Modal, Note } from './components';
import { posts, type PageId, type Post, type Scenario } from './data';
import { usePreferences } from './state';
import { Overview } from './Overview';
import { Inbox } from './Inbox';
import { Sources } from './Sources';
import { Notifications } from './Notifications';
import { Settings } from './Settings';

const navItems: [PageId, string][] = [['overview', '总览'], ['inbox', '动态收件箱'], ['sources', '数据源'], ['notifications', '通知'], ['settings', '设置']];
function initialPage(): PageId { const hash = window.location.hash.slice(1); return navItems.some(([id]) => id === hash) ? hash as PageId : 'overview'; }
export function App() {
  const [page, setPage] = useState<PageId>(initialPage);
  const [prefs, updatePrefs] = usePreferences();
  const [scenario, setScenario] = useState<Scenario>('monitoring');
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<Post | null>(posts[0]!);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState('17:12');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [modal, setModal] = useState<'help' | 'source' | 'extension' | null>(null);
  useEffect(() => {
    const onHash = () => setPage(initialPage());
    window.addEventListener('hashchange', onHash);
    return () => { window.removeEventListener('hashchange', onHash); if (toastTimer.current) clearTimeout(toastTimer.current); if (checkTimer.current) clearTimeout(checkTimer.current); };
  }, []);
  function navigate(next: PageId) { setPage(next); window.location.hash = next; }
  function notify(message: string) { if (toastTimer.current) clearTimeout(toastTimer.current); setToast(message); toastTimer.current = setTimeout(() => setToast(''), 4200); }
  function check() {
    if (checking) return;
    setChecking(true);
    checkTimer.current = setTimeout(() => {
      setChecking(false);
      if (!prefs.chrome && !prefs.rss) { notify('尚未启用任何数据源，请先到数据源页面开启一个来源'); return; }
      setCheckedAt('17:13');
      notify(scenario === 'outage' ? '模拟检查完成：连接暂未恢复，请检查数据源详情' : '模拟检查完成 · 来源在线，暂无新动态');
    }, 1400);
  }
  return <div className="preview-app" data-theme={prefs.theme}>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳到主内容</a>
    <header className="app-header"><div className="header-inner"><button className="wordmark" onClick={() => navigate('overview')} aria-label="Tibo Watch 总览"><Mark/><span>Tibo Watch</span></button><nav className="main-nav" aria-label="主导航">{navItems.map(([id, label]) => <button key={id} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)}>{label}</button>)}</nav><div className="header-tools"><button className="icon-button theme-toggle" aria-label={prefs.theme === 'light' ? '切换深色模式' : '切换浅色模式'} onClick={() => updatePrefs({ theme: prefs.theme === 'light' ? 'dark' : 'light' })}>{prefs.theme === 'light' ? <Moon size={23}/> : <Sun size={23}/>}</button><button className="icon-button help-button" aria-label="原型使用说明" onClick={() => setModal('help')}><CircleHelp size={20}/></button></div></div></header>
    <main id="main-content" className={`app-main page-${page}`} tabIndex={-1}>
      <div className="page-view" hidden={page !== 'overview'}><Overview prefs={prefs} paused={paused} onPause={() => { setPaused(value => !value); notify(paused ? '已恢复模拟监测' : '已暂停模拟监测，正式应用不受影响'); }} scenario={scenario} checkedAt={checkedAt} onNavigate={navigate} onSelect={post => { setSelected(post); navigate('inbox'); }} checking={checking} onCheck={check}/></div>
      <div className="page-view" hidden={page !== 'inbox'}><Inbox selected={selected} onSelect={setSelected} notify={notify} checking={checking} onCheck={check} showSource={() => setModal('source')}/></div>
      <div className="page-view" hidden={page !== 'sources'}><Sources prefs={prefs} update={updatePrefs} checking={checking} onCheck={check} scenario={scenario} setup={() => setModal('extension')} notify={notify}/></div>
      <div className="page-view" hidden={page !== 'notifications'}><Notifications prefs={prefs} update={updatePrefs} notify={notify}/></div>
      <div className="page-view" hidden={page !== 'settings'}><Settings prefs={prefs} update={updatePrefs} notify={notify}/></div>
    </main>
    <footer className="app-footer"><span><i/>演示数据 · 不连接真实账号</span><label>状态演示<select aria-label="状态演示" value={scenario} onChange={event => { setScenario(event.target.value as Scenario); setPaused(false); notify('已切换演示状态'); }}><option value="monitoring">监测中</option><option value="confirmed">已确认重置</option><option value="preview">有新预告</option><option value="outage">连接异常</option></select></label><span>北京时间 UTC+8</span></footer>
    {toast ? <div className="toast" role="status"><Check size={18}/><span>{toast}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setToast('')}><X size={17}/></button></div> : null}
    {modal === 'help' ? <Modal title="一份可以操作的全新界面" onClose={() => setModal(null)}><p className="modal-lead">这是 Tibo Watch 的独立设计预览。你可以放心试用，不会影响正在运行的应用。</p><div className="help-steps"><p><span>01</span>在总览查看不同状态，点击动态进入阅读面板。</p><p><span>02</span>搜索和筛选动态，查看判断说明与送达记录。</p><p><span>03</span>切换数据源、通知方式，体验检查与邮件测试反馈。</p><p><span>04</span>使用右上角切换深浅主题，或在页脚切换状态演示。</p></div><Note>示例原文与时间用于排版和流程演示，不是实时公告。原型不连接后端；邮箱和开机设置不会实际生效。</Note><div className="modal-actions"><button className="button primary" onClick={() => setModal(null)}>开始体验<ArrowRight size={17}/></button></div></Modal> : null}
    {modal === 'source' ? <Modal title="这是一条演示动态" onClose={() => setModal(null)}><p className="modal-lead">原型中的原文、发布时间和送达记录用于展示界面，不绑定真实帖子。正式接入后，这个按钮会打开对应的 X 原帖。</p><Note>你可以查看监测对象的公开主页；不会自动执行任何账号操作。</Note><div className="modal-actions"><button className="button" onClick={() => setModal(null)}>返回阅读</button><a className="button primary" href="https://x.com/thsottiaux" target="_blank" rel="noreferrer"><ExternalLink size={17}/>打开 Tibo 主页</a></div></Modal> : null}
    {modal === 'extension' ? <Modal title="安装或重新加载 Chrome 扩展" onClose={() => setModal(null)}><div className="help-steps"><p><span>01</span>在 Chrome 地址栏输入 chrome://extensions。</p><p><span>02</span>开启开发者模式，首次使用时加载扩展文件夹。</p><p><span>03</span>已安装时，点击 Tibo Watch Chrome Companion 的圆形箭头。</p><p><span>04</span>返回桌面应用检查连接，确认收到最新采集报告。</p></div><Note>这是帮助流程预览，不会打开浏览器设置、安装或重载真实扩展。</Note><div className="modal-actions"><button className="button primary" onClick={() => { setModal(null); notify('帮助流程已完成 · 真实扩展未被修改'); }}>明白了<Check size={17}/></button></div></Modal> : null}
  </div>;
}
