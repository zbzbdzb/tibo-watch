import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Windows tray icon packaging', () => {
  test('ships a non-empty PNG as a runtime resource', () => {
    const projectRoot = join(import.meta.dirname, '..', '..');
    const packageJson = JSON.parse(
      readFileSync(join(projectRoot, 'package.json'), 'utf8'),
    ) as {
      build?: { extraResources?: Array<{ from: string; to: string }> };
    };
    const png = readFileSync(join(projectRoot, 'build', 'icon.png'));

    expect(packageJson.build?.extraResources ?? []).toContainEqual({
      from: 'build/icon.png',
      to: 'tray-icon.png',
    });
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.readUInt32BE(16)).toBeGreaterThan(0);
    expect(png.readUInt32BE(20)).toBeGreaterThan(0);
  });

  test('ships the Chrome companion extension as a runtime resource', () => {
    const projectRoot = join(import.meta.dirname, '..', '..');
    const packageJson = JSON.parse(
      readFileSync(join(projectRoot, 'package.json'), 'utf8'),
    ) as {
      build?: { extraResources?: Array<{ from: string; to: string }> };
    };
    const manifest = JSON.parse(
      readFileSync(join(projectRoot, 'chrome-extension', 'manifest.json'), 'utf8'),
    ) as { manifest_version?: number; background?: { service_worker?: string } };

    expect(packageJson.build?.extraResources ?? []).toContainEqual({
      from: 'chrome-extension',
      to: 'chrome-extension',
    });
    expect(manifest).toMatchObject({
      manifest_version: 3,
      background: { service_worker: 'service-worker.js' },
    });
    expect(readFileSync(join(projectRoot, 'chrome-extension', 'service-worker.js')).length)
      .toBeGreaterThan(1_000);
  });
});
