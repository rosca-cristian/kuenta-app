import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webPlatform } from '../src/platform/web';

/** Stands in for the browser: the share API given, and a document whose download links are recorded. */
function browser(share?: { canShare: boolean; share?: () => Promise<void> }) {
  const downloads: string[] = [];
  const shared: File[][] = [];
  vi.stubGlobal(
    'navigator',
    share
      ? {
          canShare: () => share.canShare,
          share: async ({ files }: { files: File[] }) => {
            shared.push(files);
            await share.share?.();
          },
        }
      : {},
  );
  vi.stubGlobal('document', {
    body: { append: () => {} },
    createElement: () => {
      const link = { href: '', download: '', click: () => downloads.push(link.download), remove: () => {} };
      return link;
    },
  });
  return { downloads, shared };
}

const file = () => new File(['{}'], 'kuenta-copia-2026-10-20.json', { type: 'application/json' });

describe('sharing a file', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens the share menu with the file where files can be shared', async () => {
    const { downloads, shared } = browser({ canShare: true });
    expect(await webPlatform.shareFile(file())).toBe('shared');
    expect(shared.map((files) => files.map((f) => f.name))).toEqual([['kuenta-copia-2026-10-20.json']]);
    expect(downloads).toEqual([]);
  });

  it('is cancelled, downloading nothing, when the user closes the menu', async () => {
    const { downloads } = browser({ canShare: true, share: () => Promise.reject(new DOMException('Share canceled', 'AbortError')) });
    expect(await webPlatform.shareFile(file())).toBe('cancelled');
    expect(downloads).toEqual([]);
  });

  it("downloads the file where files can't be shared, or the share fails", async () => {
    const unsupported = browser();
    expect(await webPlatform.shareFile(file())).toBe('downloaded');
    expect(unsupported.downloads).toEqual(['kuenta-copia-2026-10-20.json']);

    const refused = browser({ canShare: false });
    expect(await webPlatform.shareFile(file())).toBe('downloaded');
    expect(refused.shared).toEqual([]);
    expect(refused.downloads).toEqual(['kuenta-copia-2026-10-20.json']);

    const failed = browser({ canShare: true, share: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) });
    expect(await webPlatform.shareFile(file())).toBe('downloaded');
    expect(failed.downloads).toEqual(['kuenta-copia-2026-10-20.json']);
  });
});
