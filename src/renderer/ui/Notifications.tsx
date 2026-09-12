import { useState } from 'react';
import { Bell, Mail, Monitor, Plus, RefreshCw, Send, Settings2, Trash2, Volume2, VolumeX } from 'lucide-react';
import { z } from 'zod';
import type { AppSnapshot } from '../../shared/api';
import { emailErrorLabel } from '../../shared/emailErrors';
import { deliveryLabel, deliveryTone } from '../deliveryStatus';
import { Empty, Modal, Note, SignalIcon, Toggle } from './components';
import { fullDate, type SaveSettings } from './model';
import { SmtpForm } from './SmtpForm';
const rows = [
  { level: 'confirmed', label: '确认重置', enabled: 'windowsConfirmedEnabled', sound: 'windowsConfirmedSound', note: '已宣布重置完成或正在执行' },
  { level: 'preview', label: '预告', enabled: 'windowsPreviewEnabled', sound: 'windowsPreviewSound', note: '未来重置计划与明确预告' },
  { level: 'related', label: '其他相关动态', enabled: 'windowsRelatedEnabled', sound: 'windowsRelatedSound', note: '产品限制相关讨论与更新' },
] as const;
export function Notifications({ snapshot, save, busy, notify, retry }: { snapshot: AppSnapshot; save: SaveSettings; busy: boolean; notify: (message: string) => void; retry: (id: string) => Promise<boolean> }) {
  const settings = snapshot.settings;
  const [tab, setTab] = useState<'rules'|'history'>('rules');
  const [modal, setModal] = useState<'recipient'|'smtp'|null>(null);
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [channel, setChannel] = useState('all');
  const locked = busy || testing;
  async function addRecipient(event: React.FormEvent) {
    event.preventDefault();
    const email = address.trim();
    if (!z.email().safeParse(email).success) { setError('请输入完整邮箱，例如 name@example.com'); return; }
    if (settings.emailRecipients.some(value => value.toLowerCase() === email.toLowerCase())) { setError('这个邮箱已经在列表中'); return; }
    if (settings.emailRecipients.length >= 50) { setError('最多支持 50 个收件人'); return; }
    if (await save({ emailRecipients: [...settings.emailRecipients, email] })) { setAddress(''); setModal(null); }
  }
  async function testMail() {
    if (locked) return;
    if (!window.tiboWatch) { notify('浏览器演示：未发送真实邮件'); return; }
    setTesting(true);
    try { const result = await window.tiboWatch.sendTestEmail(); notify(result.ok ? '所有收件人已获 SMTP 接受，请检查收件箱。' : `测试邮件未全部成功：${emailErrorLabel(result.errorCode)}`); }
    catch { notify('测试失败：请检查邮箱配置后重试。'); }
    finally { setTesting(false); }
  }
  const history = snapshot.deliveries.filter(item => channel === 'all' || item.channel === channel);
  return <><div className="page-heading"><h1>通知</h1></div><div className="section-tabs"><button className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}>提醒偏好</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>送达记录<span>{snapshot.deliveries.length}</span></button></div>
    {tab === 'rules' ? <div className="notification-columns"><section className="panel notification-rules"><div className="panel-heading"><Monitor/><div><h2>Windows 通知</h2>{!snapshot.windowsNotificationsSupported ? <p>当前系统不支持 Windows 通知。</p> : null}</div></div><div className="notification-table-label"><span>动态类型</span><span>声音</span><span>通知</span></div>{rows.map(row => <div className="notification-rule" key={row.level}><SignalIcon level={row.level}/><div><strong>{row.label}</strong><p>{row.note}</p></div><button className="sound-button" disabled={locked || !settings[row.enabled]} aria-label={`${row.label}${settings[row.sound] ? '声音已开启' : '声音已关闭'}`} onClick={() => void save({ [row.sound]: !settings[row.sound] })}>{settings[row.sound] ? <Volume2 size={19}/> : <VolumeX size={19}/>}<span>{settings[row.sound] ? '默认' : '静音'}</span></button><Toggle label={`${row.label}通知`} disabled={locked} checked={settings[row.enabled]} onChange={() => void save({ [row.enabled]: !settings[row.enabled] })}/></div>)}<div className="notification-rule-note"><Bell size={19}/><p>首次同步保持安静。预告升级为确认时，可以再次提醒。</p></div></section>
      <section className="panel email-panel"><div className="panel-heading"><Mail/><div><h2>邮件提醒</h2></div><Toggle label="启用邮件提醒" checked={settings.emailEnabled} disabled={locked} onChange={() => void save({ emailEnabled: !settings.emailEnabled })}/></div><div className="email-scope"><strong>发送范围</strong><span>确认重置、重置预告</span></div><div className="section-heading small"><h3>收件人 <span className="muted">{settings.emailRecipients.length}</span></h3><button className="text-button" disabled={locked} onClick={() => { setError(''); setModal('recipient'); }}><Plus size={16}/>添加</button></div>
        <div className="recipients">{settings.emailRecipients.length ? settings.emailRecipients.map(email => <div className="recipient" key={email}><span className="recipient-avatar">{email[0]?.toUpperCase()}</span><span>{email}</span><button className="icon-button" disabled={locked} aria-label={`移除 ${email}`} onClick={() => void save({ emailRecipients: settings.emailRecipients.filter(value => value !== email) })}><Trash2 size={16}/></button></div>) : <p className="muted">还没有收件人。</p>}</div><div className="smtp-summary"><div><strong>SMTP 服务</strong><span>{settings.smtpHost ? `${settings.smtpHost} · ${settings.smtpPort} · ${settings.smtpSecure ? 'SSL/TLS' : 'STARTTLS'}` : '尚未配置'}</span></div><button className="icon-button" aria-label="编辑 SMTP 配置" disabled={locked} onClick={() => setModal('smtp')}><Settings2 size={19}/></button></div><button className="button primary full-width" disabled={locked || !settings.emailEnabled || !settings.emailRecipients.length || !settings.smtpHost} onClick={() => void testMail()}>{testing ? <RefreshCw className="spin" size={17}/> : <Send size={17}/>} {testing ? '正在发送…' : '发送测试邮件'}</button><Note>使用已保存的配置向全部收件人发送。SMTP 接受不代表已进入收件箱。</Note></section>
    </div> : <section className="panel history-panel"><div className="section-heading"><div><p className="muted">失败的邮件可单独重试，不重复发送给已成功的收件人。</p></div><select aria-label="筛选通知渠道" value={channel} onChange={event => setChannel(event.target.value)}><option value="all">全部</option><option value="windows">Windows</option><option value="email">邮件</option></select></div>{history.length ? <div className="history-table"><div className="history-row table-heading"><span>动态</span><span>渠道</span><span>时间</span><span>状态</span></div>{history.map(row => <div className="history-row" key={`${row.eventId}-${row.channel}`}><p>{snapshot.posts.find(item => item.post.id === row.postId)?.post.text ?? `动态 ${row.postId}`}</p><span>{row.channel === 'email' ? <Mail size={17}/> : <Monitor size={17}/>} {row.channel === 'email' ? '邮件' : 'Windows'}</span><time>{fullDate(row.updatedAt)}</time><div className="history-delivery"><span className={`status ${deliveryTone(row) || 'online'}`}>{deliveryLabel(row)}</span>{row.lastError ? <small>{row.channel === 'email' ? emailErrorLabel(row.lastError) : row.lastError}</small> : null}{row.nextAttemptAt ? <small>下次重试 {fullDate(row.nextAttemptAt)}</small> : null}{row.channel === 'email' && row.failedRecipientCount > 0 && ['failed','partial'].includes(row.state) ? <button className="text-button" disabled={busy} onClick={() => void retry(row.eventId)}><RefreshCw size={15} className={busy ? 'spin' : ''}/>{busy ? '重试中…' : '重试失败收件人'}</button> : null}</div></div>)}</div> : <Empty title="还没有送达记录">首次建立历史基线不会补发提醒。</Empty>}</section>}
    {modal === 'recipient' ? <Modal title="添加收件人" onClose={() => { if (!busy) setModal(null); }}><form onSubmit={event => void addRecipient(event)} noValidate><label className="field">邮箱地址<input autoFocus inputMode="email" value={address} onChange={event => { setAddress(event.target.value); setError(''); }} aria-invalid={Boolean(error)} aria-describedby="recipient-error"/></label><p className="field-error" role="alert" id="recipient-error">{error}</p><div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={() => setModal(null)}>取消</button><button type="submit" className="button primary" disabled={busy}>添加收件人</button></div></form></Modal> : null}
    {modal === 'smtp' ? <SmtpForm settings={settings} save={save} busy={busy} close={() => setModal(null)}/> : null}
  </>;
}
