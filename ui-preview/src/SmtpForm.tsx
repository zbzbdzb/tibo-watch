import { useState } from 'react';
import { Modal, Note } from './components';

export interface SmtpDemo { host: string; port: string; security: string }
export function SmtpForm({ value, onClose, onSave }: { value: SmtpDemo; onClose: () => void; onSave: (value: SmtpDemo) => void }) {
  const [draft, setDraft] = useState(value);
  return <Modal title="邮件服务（演示）" onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); onSave(draft); }}>
      <Note>这些字段仅留在当前预览内，不会提交到任何服务器。请勿填写真实凭据。</Note>
      <label className="field">SMTP 主机<input required value={draft.host} onChange={event => setDraft({ ...draft, host: event.target.value })}/></label>
      <div className="form-grid">
        <label className="field">端口<input type="number" min="1" max="65535" required value={draft.port} onChange={event => setDraft({ ...draft, port: event.target.value })}/></label>
        <label className="field">加密方式<select value={draft.security} onChange={event => setDraft({ ...draft, security: event.target.value })}><option>SSL/TLS</option><option>STARTTLS</option></select></label>
      </div>
      <label className="field">应用密码<input disabled placeholder="原型不接收真实密码"/></label>
      <div className="modal-actions"><button type="button" className="button" onClick={onClose}>取消</button><button type="submit" className="button primary">保存演示邮件配置</button></div>
    </form>
  </Modal>;
}
