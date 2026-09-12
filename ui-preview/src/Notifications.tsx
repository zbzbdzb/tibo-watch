import { useState } from 'react';
import { Bell, Check, Mail, Monitor, Plus, RefreshCw, Send, Settings2, Trash2, Volume2, VolumeX } from 'lucide-react';
import { Modal, Note, SignalIcon, Status, Toggle } from './components';
import { levelLabels, type Level } from './data';
import type { Preferences } from './state';
import { SmtpForm, type SmtpDemo } from './SmtpForm';

interface Props { prefs: Preferences; update: (patch: Partial<Preferences>) => void; notify: (message: string) => void }
export function Notifications({ prefs, update, notify }: Props) {
  const [tab, setTab] = useState<'rules' | 'history'>('rules');
  const [modal, setModal] = useState<'recipient' | 'smtp' | null>(null);
  const [recipients, setRecipients] = useState(['hello@example.com']);
  const [address, setAddress] = useState('');
  const [emailError, setEmailError] = useState('');
  const [testing, setTesting] = useState(false);
  const [smtp, setSmtp] = useState<SmtpDemo>({ host: 'smtp.example.com', port: '465', security: 'SSL/TLS' });
  const { host: smtpHost, port: smtpPort } = smtp;
  const [channel, setChannel] = useState('全部');
  const [retried, setRetried] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const history = [
    { title: 'Reset will land around 14pm PST tomorrow.', channel: 'Windows', time: '今天 16:43', status: '已送达' },
    { title: 'Reset will land around 14pm PST tomorrow.', channel: '邮件', time: '今天 16:43', status: 'SMTP 已接受' },
    { title: 'Usage limits have been reset for all paid Codex subscriptions.', channel: '邮件', time: '今天 14:12', status: retried ? 'SMTP 已接受' : '等待重试' },
  ].filter(row => channel === '全部' || row.channel === channel);
  function saveRecipient(event: React.FormEvent) {
    event.preventDefault();
    const next = address.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) { setEmailError('请输入完整邮箱，例如 name@example.com'); return; }
    if (recipients.some(value => value.toLowerCase() === next.toLowerCase())) { setEmailError('这个邮箱已经在列表中'); return; }
    setRecipients(current => [...current, next]); setAddress(''); setModal(null); notify('已加入演示收件人列表 · 不会发送真实邮件');
  }
  function testMail() {
    setTesting(true);
    window.setTimeout(() => { setTesting(false); notify(`测试流程完成：已模拟向 ${recipients.length} 个收件人发送邮件（未真实发送）`); }, 1300);
  }
  return <><div className="page-heading"><div><h1>通知</h1><p>决定哪些变化值得打扰，以及用什么方式。</p></div><span className="autosave"><Check size={15}/>开关修改即时保存</span></div><div className="section-tabs"><button className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}>提醒偏好</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>送达记录<span>3</span></button></div>
    {tab === 'rules' ? <div className="notification-columns"><section className="panel notification-rules"><div className="panel-heading"><Monitor/><div><h2>Windows 通知</h2></div></div><div className="notification-table-label"><span>动态类型</span><span>声音</span><span>通知</span></div>{(['confirmed', 'preview', 'related'] as Level[]).map(level => <div className="notification-rule" key={level}><SignalIcon level={level}/><div><strong>{levelLabels[level]}</strong><p>{level === 'confirmed' ? '已宣布重置完成或正在执行' : level === 'preview' ? '未来重置计划与明确预告' : '产品限制相关讨论与更新'}</p></div><button className="sound-button" disabled={!prefs.channels[level]} aria-label={`${levelLabels[level]}${prefs.sounds[level] ? '声音已开启' : '声音已关闭'}`} onClick={() => { update({ sounds: { ...prefs.sounds, [level]: !prefs.sounds[level] } }); notify('声音偏好已保存到原型'); }}>{prefs.sounds[level] ? <Volume2 size={19}/> : <VolumeX size={19}/>}<span>{prefs.sounds[level] ? '默认' : '静音'}</span></button><Toggle label={`${levelLabels[level]}通知`} checked={prefs.channels[level]} onChange={() => { update({ channels: { ...prefs.channels, [level]: !prefs.channels[level] } }); notify('Windows 通知偏好已保存到原型'); }}/></div>)}<div className="notification-rule-note"><Bell size={19}/><p>首次同步保持安静。预告升级为确认时，可以再次提醒。</p></div><button className="button" onClick={() => notify('预览通知：Tibo 发布了新的重置预告。这是页面内演示，不调用系统通知。')}><Bell size={16}/>预览通知效果</button></section>
      <section className="panel email-panel"><div className="panel-heading"><Mail/><div><h2>邮件提醒</h2></div><Toggle checked={prefs.mail} label="启用邮件提醒" onChange={() => { update({ mail: !prefs.mail }); notify(`邮件提醒已${prefs.mail ? '停用' : '启用'} · 演示设置`); }}/></div><div className="email-scope"><strong>发送范围</strong><span>确认重置、重置预告</span></div><div className="section-heading small"><h3>收件人 <span className="muted">{recipients.length}</span></h3><button className="text-button" onClick={() => { setEmailError(''); setModal('recipient'); }}><Plus size={16}/>添加</button></div><div className="recipients">{recipients.length ? recipients.map(email => <div className="recipient" key={email}><span className="recipient-avatar">{email[0]?.toUpperCase()}</span><span>{email}</span><button className="icon-button" aria-label={`移除 ${email}`} onClick={() => { setRecipients(current => current.filter(value => value !== email)); notify('已移除演示收件人，可随时重新添加'); }}><Trash2 size={16}/></button></div>) : <p className="muted">还没有收件人，添加后可体验测试流程。</p>}</div><div className="smtp-summary"><div><strong>SMTP 服务</strong><span>{smtpHost} · {smtpPort} · 演示配置</span></div><button className="icon-button" aria-label="编辑 SMTP 配置" onClick={() => setModal('smtp')}><Settings2 size={19}/></button></div><button className="button primary full-width" disabled={testing || !prefs.mail || recipients.length === 0} onClick={testMail}>{testing ? <RefreshCw className="spin" size={17}/> : <Send size={17}/>} {testing ? '正在模拟发送…' : '发送测试邮件（演示）'}</button><Note>原型不会发送真实邮件，也不读取正式版的邮箱配置。</Note></section>
    </div> : <section className="panel history-panel"><div className="section-heading"><div><p className="muted">查看各渠道的处理状态，失败的邮件可单独重试。</p></div><select aria-label="筛选通知渠道" value={channel} onChange={event => setChannel(event.target.value)}><option>全部</option><option>Windows</option><option>邮件</option></select></div><div className="history-table"><div className="history-row table-heading"><span>动态</span><span>渠道</span><span>时间</span><span>状态</span></div>{history.map(row => <div className="history-row" key={`${row.channel}-${row.time}`}><p>{row.title}</p><span>{row.channel === '邮件' ? <Mail size={17}/> : <Monitor size={17}/>} {row.channel}</span><time>{row.time}</time><div><Status kind={row.status === '等待重试' ? 'warning' : 'online'}>{retrying && row.status === '等待重试' ? '正在重试' : row.status}</Status>{row.status === '等待重试' ? <button className="text-button" disabled={retrying} onClick={() => { setRetrying(true); window.setTimeout(() => { setRetrying(false); setRetried(true); notify('模拟重试成功，状态已更新'); }, 1100); }}>{retrying ? '重试中…' : '重试'}</button> : null}</div></div>)}</div><Note>这里展示的是演示送达记录。SMTP 已接受不保证邮件进入收件箱。</Note></section>}
    {modal === 'recipient' ? <Modal title="添加演示收件人" onClose={() => setModal(null)}><form onSubmit={saveRecipient}><p className="muted">仅用于体验界面，建议使用 example.com 示例地址。</p><label className="field">邮箱地址<input autoFocus inputMode="email" placeholder="name@example.com" value={address} onChange={event => { setAddress(event.target.value); setEmailError(''); }} aria-invalid={!!emailError} aria-describedby="email-error"/></label><p className="field-error" id="email-error" role="alert">{emailError}</p><div className="modal-actions"><button type="button" className="button" onClick={() => setModal(null)}>取消</button><button className="button primary" type="submit"><Plus size={16}/>添加收件人</button></div></form></Modal> : null}
    {modal === 'smtp' ? <SmtpForm value={smtp} onClose={() => setModal(null)} onSave={value => { setSmtp(value); setModal(null); notify('SMTP 演示表单已保存 · 未连接服务器'); }}/> : null}
  </>;
}
