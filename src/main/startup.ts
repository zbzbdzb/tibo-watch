export const HIDDEN_STARTUP_ARGUMENT = '--hidden';

export function isHiddenStartup(args: readonly string[]): boolean {
  return args.includes(HIDDEN_STARTUP_ARGUMENT);
}

export function shouldShowForSecondInstance(args: readonly string[]): boolean {
  return !isHiddenStartup(args);
}

export function startupShortcutWriteOperation(shortcutExists: boolean): 'create' | 'replace' {
  return shortcutExists ? 'replace' : 'create';
}

export function buildStartupShortcutDetails(executablePath: string): {
  target: string;
  args: string;
  description: string;
  appUserModelId: string;
  icon: string;
  iconIndex: number;
} {
  return {
    target: executablePath,
    args: HIDDEN_STARTUP_ARGUMENT,
    description: '静默启动 Tibo Watch',
    appUserModelId: 'com.tibowatch.desktop',
    icon: executablePath,
    iconIndex: 0,
  };
}

export function buildLoginItemSettings(
  startAtLogin: boolean,
  platform: NodeJS.Platform,
  executablePath: string,
): {
  openAtLogin: boolean;
  path?: string;
  args?: string[];
} {
  if (platform !== 'win32') return { openAtLogin: startAtLogin };

  return {
    openAtLogin: startAtLogin,
    path: executablePath,
    args: [HIDDEN_STARTUP_ARGUMENT],
  };
}
