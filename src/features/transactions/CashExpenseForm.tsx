import { useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../ui/components';
import { CategoryGrid } from '../../ui/pickers';
import { Money, usePrivacyMode } from '../../lib/money';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { addDays, formatDate, today, type IsoDate } from '../../domain/dates';
import { formatTypedAmount, parseTypedAmount, type Cents } from '../../domain/money';
import { cashCategoryOf } from '../../domain/cash';
import type { Id } from '../../domain/model';
import type { CashExpenseView } from '../../data/repository';

const amountHint = 'Escribe un importe mayor que 0, por ejemplo 12,50.';
const categoryHint = 'Elige en qué gastaste el efectivo.';

/** Why the form can't be saved: a hint, or the cash it can take on its date. */
type FormError = { hint: string } | { available: Cents; later: boolean };

/**
 * Notes down what some cash paid for, or edits it: an amount, an expense category other than
 * "Efectivo", a date (today by default, never later) and a note. Kuenta pays it from the cash
 * pocket, and refuses it when the cash held on its date can't. `expense` edits one and offers
 * "Borrar".
 */
export function CashExpenseForm({ expense, onDone }: { expense?: CashExpenseView; onDone: () => void }) {
  const repo = useRepo();
  const categories = useRepoQuery((r) => r.listCategories());
  // In privacy mode the amount starts empty rather than giving it away.
  const hidden = usePrivacyMode();
  const [text, setText] = useState(() => (hidden || !expense ? '' : formatTypedAmount(expense.amount)));
  const [categoryId, setCategoryId] = useState<Id | null>(expense?.categoryId ?? null);
  const [date, setDate] = useState<IsoDate>(expense?.date ?? today());
  const [note, setNote] = useState(expense?.note ?? '');
  const [error, setError] = useState<FormError | null>(null);
  const [busy, setBusy] = useState(false);

  const cashId = categories && cashCategoryOf(categories)?.id;
  const options = (categories ?? []).filter((category) => category.kind === 'expense' && category.id !== cashId);
  const last = today();

  function edit<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setError(null);
    };
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const amount = parseTypedAmount(text);
    if (amount === null || amount <= 0) return setError({ hint: amountHint });
    if (categoryId === null) return setError({ hint: categoryHint });
    setBusy(true);
    const draft = { amount, categoryId, date, note: note.trim() };
    const result = expense ? await repo.updateCashExpense(expense.id, draft) : await repo.addCashExpense(draft);
    setBusy(false);
    if (result.ok) onDone();
    else setError({ available: result.available, later: result.later });
  }

  async function remove() {
    if (!expense) return;
    setBusy(true);
    await repo.deleteCashExpense(expense.id);
    onDone();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-muted">
        Importe
        <input
          value={text}
          onChange={(event) => edit(setText)(event.target.value)}
          inputMode="decimal"
          placeholder="0,00"
          autoComplete="off"
          className="min-h-11 rounded-xl border border-line bg-card-2 px-3 text-base text-text tabular-nums outline-none focus:border-accent"
        />
      </label>

      <CategoryGrid categories={options} value={categoryId} onPick={(id) => edit(setCategoryId)(id)} />

      <div className="flex flex-col gap-1 text-sm text-muted">
        <span id="cash-date">Fecha</span>
        <div className="flex items-center gap-2" role="group" aria-labelledby="cash-date">
          <button
            type="button"
            aria-label="Día anterior"
            className="flex size-11 items-center justify-center rounded-xl bg-card-2 text-text"
            onClick={() => edit(setDate)(addDays(date, -1))}
          >
            <ChevronLeft size={20} aria-hidden />
          </button>
          <span className="flex-1 text-center text-base text-text" data-testid="cash-date">
            {date === last ? `Hoy, ${formatDate(date)}` : formatDate(date)}
          </span>
          <button
            type="button"
            aria-label="Día siguiente"
            disabled={date >= last}
            className="flex size-11 items-center justify-center rounded-xl bg-card-2 text-text disabled:opacity-40"
            onClick={() => edit(setDate)(addDays(date, 1))}
          >
            <ChevronRight size={20} aria-hidden />
          </button>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm text-muted">
        Nota
        <textarea
          value={note}
          rows={2}
          onChange={(event) => edit(setNote)(event.target.value)}
          className="rounded-xl border border-line bg-card-2 px-3 py-2 text-base text-text outline-none focus:border-accent"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {'hint' in error ? (
            error.hint
          ) : error.later ? (
            <>
              Solo puedes gastar <Money cents={error.available} className="tabular-nums" /> de efectivo a esa fecha sin dejar sin efectivo gastos
              posteriores
            </>
          ) : (
            <>
              Solo tienes <Money cents={error.available} className="tabular-nums" /> de efectivo a esa fecha
            </>
          )}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        Guardar
      </Button>
      {expense && (
        <Button type="button" variant="danger" onClick={remove} disabled={busy}>
          Borrar
        </Button>
      )}
    </form>
  );
}
