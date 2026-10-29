import type { FocusEvent, ReactNode } from 'react';
import { X } from 'lucide-react';
import { Drawer } from 'vaul';

/** About how long a phone's keyboard takes to open, after which the focused field can be scrolled to. */
const KEYBOARD_DELAY_MS = 300;

/** Once the keyboard is up, the field being typed in is scrolled to the middle of what's left of the sheet. */
function revealField(event: FocusEvent<HTMLDivElement>) {
  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return;
  setTimeout(() => field.scrollIntoView({ block: 'center' }), KEYBOARD_DELAY_MS);
}

/**
 * A bottom sheet. Only its handle drags it down, so scrolling or swiping inside it never closes
 * it; the cross, a tap outside or Escape do.
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Drawer.Root open={open} onOpenChange={(next) => !next && onClose()} handleOnly>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border-t border-line bg-card pb-[env(safe-area-inset-bottom)] outline-none"
        >
          <Drawer.Handle className="mx-auto mt-3 !h-1.5 !w-10 !rounded-full !bg-line !opacity-100" />
          <div className="flex items-center gap-2 pl-4 pr-1 pt-1">
            <Drawer.Title className="min-w-0 flex-1 py-2 text-lg font-semibold">{title}</Drawer.Title>
            <button type="button" aria-label="Cerrar" className="flex size-11 shrink-0 items-center justify-center text-muted" onClick={onClose}>
              <X size={20} aria-hidden />
            </button>
          </div>
          <div className="overflow-y-auto overscroll-contain px-4 pb-4" onFocus={revealField}>
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
