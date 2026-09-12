import { useState } from 'react';
import type { Level } from './data';

export interface Preferences {
  theme: 'light' | 'dark'; chrome: boolean; rss: boolean; mail: boolean;
  channels: Record<Level, boolean>; sounds: Record<Level, boolean>;
  interval: string; autoStart: boolean; hidden: boolean; tray: boolean;
}
export const defaults: Preferences = {
  theme: 'light', chrome: true, rss: true, mail: true,
  channels: { confirmed: true, preview: true, related: false },
  sounds: { confirmed: true, preview: true, related: false },
  interval: '15', autoStart: true, hidden: true, tray: true,
};
const KEY = 'tibo-watch-ui-preview:v1';
function readPrefs(): Preferences {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Preferences>;
    return {
      ...defaults,
      theme: data.theme === 'dark' ? 'dark' : 'light',
      ...Object.fromEntries(['chrome', 'rss', 'mail', 'autoStart', 'hidden', 'tray'].flatMap(key =>
        typeof data[key as keyof Preferences] === 'boolean' ? [[key, data[key as keyof Preferences]]] : [])),
      channels: { ...defaults.channels, ...data.channels }, sounds: { ...defaults.sounds, ...data.sounds },
      interval: ['5', '10', '15', '30'].includes(String(data.interval)) ? String(data.interval) : '15',
    };
  } catch { return defaults; }
}
export function usePreferences() {
  const [prefs, setPrefs] = useState(readPrefs);
  function updatePrefs(update: Partial<Preferences>) {
    setPrefs(current => {
      const next = { ...current, ...update };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Preview still works without storage. */ }
      return next;
    });
  }
  return [prefs, updatePrefs] as const;
}
