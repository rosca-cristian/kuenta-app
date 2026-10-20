import { useMemo, useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Amount, Button } from '../../ui/components';
import { IconBadge } from '../../ui/icons';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { formatDate } from '../../domain/dates';
import type { Category, Id } from '../../domain/model';
import type { TransactionView } from '../../data/repository';

/** Edits the parts of a transaction that belong to the user: category, payee and note. */
export function EditTransactionSheet({ id, onClose }: { id: Id | null; onClose: () => void }) {
  const tx = useRepoQuery((r) => (id ? r.getTransaction(id) : Promise.resolve(null)), [id]);
  return (
    <Sheet open={id !== null} onClose={onClose} title={tx?.source === 'adjustment' ? 'Ajuste de saldo' : 'Movimiento'}>
      {tx && <EditForm key={tx.id} tx={tx} onDone={onClose} />}
    </Sheet>
  );
}

function EditForm({ tx, onDone }: { tx: TransactionView; onDone: () => void }) {
  const repo = useRepo();
  const categories = useRepoQuery((r) => r.listCategories());
  const usedThatDay = useRepoQuery((r) => r.expenseCategoriesUsedOn(tx.date), [tx.date]);
  const [categoryId, setCategoryId] = useState<Id | null>(tx.categoryId);
  const [payeeName, setPayeeName] = useState(tx.payee?.name ?? '');
  const [note, setNote] = useState(tx.note);

  // For an incoming amount, the expense categories used that day come first: a friend's
  // Bizum for a shared dinner usually belongs with the dinner.
  const ordered = useMemo(() => {
    if (!categories) return [];
    const rank = (category: Category) => {
      if (tx.type === 'income') {
        const used = (usedThatDay ?? []).indexOf(category.id);
        if (used >= 0) return used;
      }
      return 100 + (category.kind === tx.type ? 0 : 100) + category.order;
    };
    return [...categories].sort((a, b) => rank(a) - rank(b));
  }, [tx.type, categories, usedThatDay]);

  async function save() {
    await repo.updateTransaction(tx.id, { categoryId, payeeName, note });
    onDone();
  }

  async function removeAdjustment() {
    await repo.deleteAdjustment(tx.id);
    onDone();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <Amount cents={tx.amount} kind={tx.type === 'income' ? 'income' : 'expense'} className="text-3xl font-semibold" />
        <p className="mt-1 text-sm text-muted">
          {formatDate(tx.date)} · {tx.account.name}
        </p>
      </div>

      {tx.source === 'import' && (
        <>
          <fieldset>
            <legend className="mb-2 text-sm text-muted">Categoría</legend>
            <div className="grid grid-cols-4 gap-2">
              {ordered.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setCategoryId(categoryId === category.id ? null : category.id)}
                  aria-pressed={categoryId === category.id}
                  className={`flex flex-col items-center gap-1 rounded-xl p-2 text-[11px] leading-tight ${
                    categoryId === category.id ? 'bg-accent/20 ring-1 ring-accent' : 'bg-card-2'
                  }`}
                >
                  <IconBadge icon={category.icon} color={category.color} size={32} />
                  <span className="line-clamp-2 text-center">{category.name}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1 text-sm text-muted">
            Comercio
            <input
              value={payeeName}
              onChange={(event) => setPayeeName(event.target.value)}
              className="min-h-11 rounded-xl border border-line bg-card-2 px-3 text-base text-text outline-none focus:border-accent"
            />
          </label>
        </>
      )}

      <label className="flex flex-col gap-1 text-sm text-muted">
        Nota
        <textarea
          value={note}
          rows={2}
          onChange={(event) => setNote(event.target.value)}
          className="rounded-xl border border-line bg-card-2 px-3 py-2 text-base text-text outline-none focus:border-accent"
        />
      </label>

      {tx.bankConcept !== null && (
        <div className="rounded-xl bg-card-2 p-3 text-xs text-muted">
          <p>Concepto del banco: {tx.bankConcept}</p>
          {tx.bankMovement && <p>Movimiento: {tx.bankMovement}</p>}
          {tx.bookingDate && tx.bookingDate !== tx.date && <p>Fecha contable: {formatDate(tx.bookingDate)}</p>}
        </div>
      )}

      <Button onClick={save}>Guardar</Button>
      {tx.source === 'adjustment' && (
        <Button variant="danger" onClick={removeAdjustment}>
          Borrar ajuste
        </Button>
      )}
    </div>
  );
}
