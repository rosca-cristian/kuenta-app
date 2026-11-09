import { useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import type { CashExpenseView } from '../../data/repository';
import { CashExpenseForm } from './CashExpenseForm';

/** A cash expense's own sheet: edits it or deletes it ("Borrar"). Opened with the expense, closed with null. */
export function CashExpenseSheet({ expense, onClose }: { expense: CashExpenseView | null; onClose: () => void }) {
  // Kept while the sheet slides away, so it doesn't empty as it closes.
  const [shown, setShown] = useState(expense);
  if (expense && expense !== shown) setShown(expense);
  return (
    <Sheet open={expense !== null} onClose={onClose} title="Gasto en efectivo">
      {shown && <CashExpenseForm key={`${shown.id} ${shown.updatedAt}`} expense={shown} onDone={onClose} />}
    </Sheet>
  );
}
