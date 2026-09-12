import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSnapshot, SettingsUpdate } from '../../shared/api';
import { demoSnapshot, emptySnapshot } from '../demoData';
import type { PageId, Theme } from './model';
const THEME_KEY = 'tibo-watch-theme';
function initialTheme(): Theme { try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } }
export function useApplication() {
  const api = window.tiboWatch;
  const browserPreview = !api && /^https?:$/.test(window.location.protocol);
  const [snapshot, setSnapshot] = useState<AppSnapshot>(() => browserPreview ? structuredClone(demoSnapshot) : emptySnapshot);
  const [loaded, setLoaded] = useState(browserPreview);
  const [loadError, setLoadError] = useState(!api && !browserPreview);
  const [page, navigate] = useState<PageId>('overview');
  const [selectedId, select] = useState<string | null>(null);
  const [theme, setTheme] = useState(initialTheme);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkPending, setCheckPending] = useState(false);
  const actionLock = useRef(false);
  const checkLock = useRef(false);
  const notify = useCallback((text: string) => setMessage(text), []);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 5000); return () => clearTimeout(timer); }, [message]);
  useEffect(() => { try { localStorage.setItem(THEME_KEY, theme); } catch { /* Theme remains usable without storage. */ } document.documentElement.style.colorScheme = theme; }, [theme]);
  useEffect(() => {
    if (!api) return;
    let active = true, pushed = false;
    const unsubscribe = api.onSnapshot(value => { if (active) { pushed = true; setSnapshot(value); setLoaded(true); setLoadError(false); } });
    void api.getSnapshot().then(value => { if (active && !pushed) { setSnapshot(value); setLoaded(true); } }).catch(() => { if (active && !pushed) setLoadError(true); });
    const stopNavigation = api.onNavigatePost(id => { select(id); navigate('inbox'); });
    return () => { active = false; unsubscribe(); stopNavigation(); };
  }, [api]);
  async function action(work: () => Promise<AppSnapshot>, success: string) {
    if (actionLock.current) return false;
    actionLock.current = true; setBusy(true);
    try { setSnapshot(await work()); notify(success); return true; }
    catch { notify('操作失败，界面仍保留上次保存的配置，请重试。'); return false; }
    finally { actionLock.current = false; setBusy(false); }
  }
  async function save(patch: SettingsUpdate) {
    if (api) return action(() => api.updateSettings(patch), '设置已保存');
    const { smtpPassword, ...settings } = patch;
    setSnapshot(current => ({ ...current, settings: { ...current.settings, ...settings, hasSmtpPassword: Boolean(smtpPassword) || current.settings.hasSmtpPassword } }));
    notify('浏览器演示：未修改桌面配置'); return true;
  }
  async function check() {
    if (checkLock.current || snapshot.checking) return;
    checkLock.current = true; setCheckPending(true);
    const started = Date.now();
    try {
      if (!api) { notify('浏览器演示：未执行真实检查'); return; }
      const next = await api.checkNow(); setSnapshot(next);
      notify(next.lastCheckError ? '检查未完成，请查看数据源详情' : '检查完成，请查看最新采集状态');
    } catch { notify('检查失败，请检查数据源连接后重试。'); }
    finally { await new Promise(resolve => setTimeout(resolve, Math.max(0, 650 - (Date.now() - started)))); checkLock.current = false; setCheckPending(false); }
  }
  async function openPost(url: string) {
    try { if (api) await api.openPost(url); else window.open(url, '_blank', 'noopener,noreferrer'); }
    catch { notify('无法打开原帖，请稍后重试。'); }
  }
  async function pause() {
    if (api) await action(() => api.setPaused(!snapshot.paused), snapshot.paused ? '已恢复监测' : '已暂停监测');
    else setSnapshot(current => ({ ...current, paused: !current.paused }));
  }
  return { api, snapshot, loaded, loadError, page, navigate, selectedId, select, theme, setTheme, message, notify, busy, checking: checkPending || snapshot.checking, save, action, check, openPost, pause };
}
