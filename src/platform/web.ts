import type { PlatformServices } from './platform';
import { SHARE_CACHE, SHARED_FILE_URL, SHARED_NAME_HEADER } from './shared';

/** A download of the file through a temporary link. */
async function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked once the click has handed the file to the browser's download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const webPlatform: PlatformServices = {
  async takeSharedFile() {
    if (!('caches' in window)) return null;
    const cache = await caches.open(SHARE_CACHE);
    const response = await cache.match(SHARED_FILE_URL);
    if (!response) return null;
    await cache.delete(SHARED_FILE_URL);
    const name = decodeURIComponent(response.headers.get(SHARED_NAME_HEADER) ?? 'movimientos.xlsx');
    return new File([await response.blob()], name, { type: response.headers.get('Content-Type') ?? '' });
  },

  async requestPersistence() {
    return navigator.storage?.persist ? navigator.storage.persist() : false;
  },

  async isPersisted() {
    return navigator.storage?.persisted ? navigator.storage.persisted() : false;
  },

  saveFile,

  async shareFile(file) {
    const shareable = shareableCopy(file);
    if (shareable) {
      try {
        await navigator.share({ files: [shareable] });
        return 'shared';
      } catch (error) {
        if ((error as Error | null)?.name === 'AbortError') return 'cancelled';
        // Any other refusal (e.g. the file type isn't allowed): the download still gives the user a copy.
      }
    }
    await saveFile(file);
    return 'downloaded';
  },
};

/**
 * The file as the browser will share it, or null when it can't. Chrome only shares some file
 * types, and JSON isn't one of them, so a file it refuses goes as plain text with a `.txt` name,
 * which "Restaurar copia" also accepts.
 */
function shareableCopy(file: File): File | null {
  if (!navigator.canShare) return null;
  if (navigator.canShare({ files: [file] })) return file;
  const text = new File([file], file.name.replace(/\.[^.]*$/, '') + '.txt', { type: 'text/plain' });
  return navigator.canShare({ files: [text] }) ? text : null;
}
