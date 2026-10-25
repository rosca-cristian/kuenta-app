import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webPlatform } from '../src/platform/web';
import { formatStorageUsage, LIBRARIES } from '../src/features/more/about';

const packageJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

describe('Licencias', () => {
  it("lists every runtime dependency, and what they depend on, but no development tool", () => {
    const names = LIBRARIES.map((library) => library.name);
    for (const dependency of Object.keys(packageJson('../package.json').dependencies)) expect(names).toContain(dependency);
    expect(names).toEqual(expect.arrayContaining(['d3-shape', 'scheduler', 'workbox-core']));
    for (const tool of Object.keys(packageJson('../package.json').devDependencies)) expect(names).not.toContain(tool);
    expect(names.some((name) => name.startsWith('@types/'))).toBe(false);
  });

  it('gives each library the version installed and the licence it declares', () => {
    for (const library of LIBRARIES) {
      let installed: { version: string; license: string };
      try {
        installed = packageJson(`../node_modules/${library.name}/package.json`);
      } catch {
        continue; // Installed nested under another package, at a different version.
      }
      if (installed.version !== library.version) continue;
      expect(library.license).toBe(installed.license);
    }
  });
});

describe('space used', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is the browser's estimate of the bytes used", async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 2_345_678, quota: 1e9 }) } });
    expect(await webPlatform.storageUsage()).toBe(2_345_678);
  });

  it("is unknown where the browser can't estimate it, or the estimate fails", async () => {
    vi.stubGlobal('navigator', {});
    expect(await webPlatform.storageUsage()).toBeNull();
    vi.stubGlobal('navigator', { storage: {} });
    expect(await webPlatform.storageUsage()).toBeNull();
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({}) } });
    expect(await webPlatform.storageUsage()).toBeNull();
    vi.stubGlobal('navigator', { storage: { estimate: () => Promise.reject(new DOMException('No', 'SecurityError')) } });
    expect(await webPlatform.storageUsage()).toBeNull();
  });

  it('shows in megabytes with one decimal, or "—"', () => {
    expect(formatStorageUsage(2_345_678)).toBe('2,3 MB');
    expect(formatStorageUsage(0)).toBe('0,0 MB');
    expect(formatStorageUsage(1_234_500_000)).toBe('1.234,5 MB');
    expect(formatStorageUsage(null)).toBe('—');
  });
});
