import type { PlatformServices } from './platform';
import { SHARE_CACHE, SHARED_FILE_URL, SHARED_NAME_HEADER } from './shared';

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

  async saveFile(file) {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    // Revoked once the click has handed the file to the browser's download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },
};
