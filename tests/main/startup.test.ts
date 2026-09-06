interface StartupModule {
  HIDDEN_STARTUP_ARGUMENT: string;
  isHiddenStartup(args: readonly string[]): boolean;
  shouldShowForSecondInstance(args: readonly string[]): boolean;
  startupShortcutWriteOperation(shortcutExists: boolean): 'create' | 'replace';
  buildStartupShortcutDetails(executablePath: string): {
    target: string;
    args: string;
    description: string;
    appUserModelId: string;
    icon: string;
    iconIndex: number;
  };
  buildLoginItemSettings(
    startAtLogin: boolean,
    platform: NodeJS.Platform,
    executablePath: string,
  ): {
    openAtLogin: boolean;
    path?: string;
    args?: string[];
  };
}

async function loadStartup(): Promise<StartupModule | null> {
  const url = new URL('../../src/main/startup.ts', import.meta.url).href;
  return import(url).catch(() => null) as Promise<StartupModule | null>;
}

describe('Windows login startup', () => {
  test('recognizes only the explicit hidden startup argument', async () => {
    const startup = await loadStartup();
    expect(startup).not.toBeNull();
    if (!startup) return;

    expect(startup.isHiddenStartup(['Tibo Watch.exe', '--hidden'])).toBe(true);
    expect(startup.isHiddenStartup(['Tibo Watch.exe'])).toBe(false);
    expect(startup.isHiddenStartup(['Tibo Watch.exe', '--hidden=false'])).toBe(false);
  });

  test('registers Windows login startup with the hidden argument', async () => {
    const startup = await loadStartup();
    expect(startup).not.toBeNull();
    if (!startup) return;

    expect(startup.buildLoginItemSettings(
      true,
      'win32',
      'C:\\Program Files\\Tibo Watch\\Tibo Watch.exe',
    )).toEqual({
      openAtLogin: true,
      path: 'C:\\Program Files\\Tibo Watch\\Tibo Watch.exe',
      args: ['--hidden'],
    });
  });

  test('does not show the existing window when a hidden login launch becomes the second instance', async () => {
    const startup = await loadStartup();
    expect(startup).not.toBeNull();
    if (!startup) return;

    expect(startup.shouldShowForSecondInstance(['Tibo Watch.exe', '--hidden'])).toBe(false);
    expect(startup.shouldShowForSecondInstance(['Tibo Watch.exe'])).toBe(true);
  });

  test('creates a Windows startup shortcut that always carries the hidden argument', async () => {
    const startup = await loadStartup();
    expect(startup).not.toBeNull();
    if (!startup) return;

    expect(startup.buildStartupShortcutDetails(
      'C:\\Program Files\\Tibo Watch\\Tibo Watch.exe',
    )).toEqual({
      target: 'C:\\Program Files\\Tibo Watch\\Tibo Watch.exe',
      args: '--hidden',
      description: '静默启动 Tibo Watch',
      appUserModelId: 'com.tibowatch.desktop',
      icon: 'C:\\Program Files\\Tibo Watch\\Tibo Watch.exe',
      iconIndex: 0,
    });
  });

  test('creates a missing startup shortcut and replaces an existing one', async () => {
    const startup = await loadStartup();
    expect(startup).not.toBeNull();
    if (!startup) return;

    expect(startup.startupShortcutWriteOperation(false)).toBe('create');
    expect(startup.startupShortcutWriteOperation(true)).toBe('replace');
  });
});
