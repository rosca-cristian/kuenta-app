import { useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import type { CashExpenseView } from '../../data/repository';
import { CashExpenseForm } from './CashExpenseForm';

/**
 * A cash expense's own sheet: notes down a new one ('new', "Apuntar gasto en efectivo"), or edits
 * one or deletes it ("Borrar"). Closed with null.
 */
export function CashExpenseSheet({ expense, onClose }: { expense: CashExpenseView | 'new' | null; onClose: () => void }) {
  // Kept while the sheet slides away, so it doesn't empty as it closes.
  const [shown, setShown] = useState(expense);
  if (expense && expense !== shown) setShown(expense);
  return (
    <Sheet open={expense !== null} onClose={onClose} title="Gasto en efectivo">
      {shown === 'new' && <CashExpenseForm key="new" onDone={onClose} />}
      {shown && shown !== 'new' && <CashExpenseForm key={`${shown.id} ${shown.updatedAt}`} expense={shown} onDone={onClose} />}
    </Sheet>
  );
}
