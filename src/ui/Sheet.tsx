import type { ReactNode } from 'react';
import { Drawer } from 'vaul';

/** A bottom sheet. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Drawer.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border-t border-line bg-card pb-[env(safe-area-inset-bottom)] outline-none"
        >
          <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-line" />
          <Drawer.Title className="px-4 pt-3 pb-2 text-lg font-semibold">{title}</Drawer.Title>
          <div className="overflow-y-auto px-4 pb-4">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
