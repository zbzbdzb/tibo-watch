import { useState } from 'react';
import type { RendererSettings } from '../../shared/api';
import { Modal, Note } from './components';
import type { SaveSettings } from './model';
export function SmtpForm({ settings, save, busy, close }: { settings: RendererSettings; save: SaveSettings; busy: boolean; close: () => void }) {
  const [draft, setDraft] = useState(() => ({ smtpHost: settings.smtpHost, smtpPort: String(settings.smtpPort), smtpSecure: settings.smtpSecure, smtpUsername: settings.smtpUsername, smtpFrom: settings.smtpFrom }));
  const [password, setPassword] = useState('');
  return <Modal title="邮件服务" onClose={() => { if (!busy) close(); }}><form onSubmit={event => { event.preventDefault(); void save({ ...draft, smtpPort: Number(draft.smtpPort), ...(password ? { smtpPassword: password } : {}) }).then(ok => { if (ok) { setPassword(''); close(); } }); }}>
    <fieldset disabled={busy} className="smtp-fields"><label className="field">SMTP 主机<input required maxLength={255} value={draft.smtpHost} onChange={event => setDraft({ ...draft, smtpHost: event.target.value })}/></label>
    <div className="form-grid"><label className="field">端口<input type="number" required min={1} max={65535} value={draft.smtpPort} onChange={event => setDraft({ ...draft, smtpPort: event.target.value })}/></label><label className="field">加密方式<select value={draft.smtpSecure ? 'ssl' : 'starttls'} onChange={event => setDraft({ ...draft, smtpSecure: event.target.value === 'ssl' })}><option value="ssl">SSL / TLS</option><option value="starttls">STARTTLS</option></select></label></div>
    <label className="field">用户名<input maxLength={255} value={draft.smtpUsername} onChange={event => setDraft({ ...draft, smtpUsername: event.target.value })}/></label><label className="field">发件人<input maxLength={255} value={draft.smtpFrom} onChange={event => setDraft({ ...draft, smtpFrom: event.target.value })}/></label>
    <label className="field">应用密码<input type="password" autoComplete="new-password" maxLength={2048} value={password} placeholder={settings.hasSmtpPassword ? '已安全保存；留空则不修改' : '请输入应用密码'} onChange={event => setPassword(event.target.value)}/></label><Note>密码由系统加密保存，不会回传到界面。留空保留原密码。</Note>
    </fieldset><div className="modal-actions"><button className="button" type="button" disabled={busy} onClick={close}>取消</button><button className="button primary" disabled={busy} type="submit">{busy ? '保存中…' : '保存邮件配置'}</button></div>
  </form></Modal>;
}
