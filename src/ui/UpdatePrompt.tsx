import { useEffect, useRef, useState } from 'react';
import { Workbox } from 'workbox-window';

/** Registers the service worker and offers new versions without reloading behind the user's back. */
export function UpdatePrompt() {
  const workbox = useRef<Workbox | null>(null);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    const wb = new Workbox(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
    wb.addEventListener('waiting', () => setWaiting(true));
    wb.addEventListener('controlling', () => window.location.reload());
    void wb.register();
    workbox.current = wb;
  }, []);

  if (!waiting) return null;
  return (
    <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-40 flex items-center justify-between gap-3 rounded-xl border border-line bg-card-2 px-4 py-3 text-sm shadow-lg">
      <span>Hay una versión nueva</span>
      <button className="min-h-11 font-medium text-accent" onClick={() => workbox.current?.messageSkipWaiting()}>
        Actualizar
      </button>
    </div>
  );
}
