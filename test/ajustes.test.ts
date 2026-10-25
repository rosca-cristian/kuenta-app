import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webPlatform } from '../src/platform/web';
import { formatStorageUsage, LIBRARIES } from '../src/features/more/about';

const packageJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

describe('Licencias', () => {
  it("lists exactly the app's runtime dependencies", () => {
    const dependencies = Object.keys(packageJson('../package.json').dependencies).sort();
    expect(LIBRARIES.map((library) => library.name).sort()).toEqual(dependencies);
  });

  it('gives each library the version installed and the licence it declares', () => {
    for (const library of LIBRARIES) {
      const installed = packageJson(`../node_modules/${library.name}/package.json`);
      expect({ name: library.name, version: library.version, license: library.license }).toEqual({
        name: library.name,
        version: installed.version,
        license: installed.license,
      });
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
