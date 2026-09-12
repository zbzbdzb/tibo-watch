import { useRef, useState } from 'react';
import { Check, Clock3, Computer, Globe2, Moon, Palette, SlidersHorizontal, Sun } from 'lucide-react';
import type { RendererSettings } from '../../shared/api';
import { Toggle } from './components';
import type { SaveSettings, Theme } from './model';
import { TimeZoneConverter } from './TimeZoneConverter';

export function Settings({ settings, save, busy, theme, setTheme }: { settings: RendererSettings; save: SaveSettings; busy: boolean; theme: Theme; setTheme: (theme: Theme) => void }) {
  const [tab, setTab] = useState<'general' | 'timezone' | 'appearance'>('general');
  const [timezoneOpened, setTimezoneOpened] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const intervals = [...new Set([5, 10, 15, 30, settings.pollIntervalMinutes])].sort((a, b) => a - b);
  const changeTab = (value: typeof tab) => { setTab(value); if (value === 'timezone') setTimezoneOpened(true); if (scroll.current) scroll.current.scrollTop = 0; };
  return <><div className="page-heading"><h1>设置</h1></div>
    <div className="settings-layout"><nav className="settings-nav" aria-label="设置分类">
      <button className={tab === 'general' ? 'active' : ''} aria-current={tab === 'general' ? 'page' : undefined} onClick={() => changeTab('general')}><SlidersHorizontal size={19}/>常规与启动</button>
      <button className={tab === 'timezone' ? 'active' : ''} aria-current={tab === 'timezone' ? 'page' : undefined} onClick={() => changeTab('timezone')}><Globe2 size={19}/>时区换算</button>
      <button className={tab === 'appearance' ? 'active' : ''} aria-current={tab === 'appearance' ? 'page' : undefined} onClick={() => changeTab('appearance')}><Palette size={19}/>外观</button>
    </nav><div className="settings-content" ref={scroll} role="region" aria-label="设置内容" tabIndex={0}>
      <div className="settings-pane" hidden={tab !== 'general'}>
        <section className="panel settings-panel"><div className="panel-heading"><Clock3/><h2>监测节奏</h2></div><div className="setting-row"><div><strong>检查间隔</strong><p>手动检查不受此间隔限制。</p></div><select aria-label="检查间隔" value={settings.pollIntervalMinutes} disabled={busy} onChange={event => void save({ pollIntervalMinutes: Number(event.target.value) })}>{intervals.map(value => <option key={value} value={value}>每 {value} 分钟</option>)}</select></div></section>
        <section className="panel settings-panel"><div className="panel-heading"><Computer/><div><h2>启动与后台</h2><p>不用时收进托盘，需要时随时回来。</p></div></div><div className="setting-row"><div><strong>开机自动启动</strong><p>登录 Windows 后静默进入托盘，不弹出主窗口。</p></div><Toggle label="开机自动启动" checked={settings.startAtLogin} disabled={busy} onChange={() => void save({ startAtLogin: !settings.startAtLogin })}/></div><div className="setting-row"><div><strong>关闭窗口后继续监测</strong><p>从托盘「退出」才会停止；手动打开会正常显示主窗口。</p></div><Toggle label="关闭窗口后继续监测" checked={settings.closeToTray} disabled={busy} onChange={() => void save({ closeToTray: !settings.closeToTray })}/></div></section>
      </div>
      <div className="settings-pane" hidden={tab !== 'timezone'}>{timezoneOpened ? <TimeZoneConverter/> : null}</div>
      <div className="settings-pane" hidden={tab !== 'appearance'}><section className="panel settings-panel"><div className="panel-heading"><Palette/><h2>外观</h2></div><div className="theme-options">{(['light', 'dark'] as const).map(value => <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}><span className={`theme-swatch ${value}`}><i/><i/><i/></span><span>{value === 'light' ? <Sun size={17}/> : <Moon size={17}/>} {value === 'light' ? '浅色 · 晨光' : '深色 · 夜航'}{theme === value ? <Check size={16}/> : null}</span></button>)}</div></section></div>
    </div></div></>;
}
