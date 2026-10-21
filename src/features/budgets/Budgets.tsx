import { useState, type FormEvent } from 'react';
import { Button, Card, EmptyState, PageHeader } from '../../ui/components';
import { Sheet } from '../../ui/Sheet';
import { IconBadge } from '../../ui/icons';
import { CategoryGrid } from '../../ui/pickers';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { formatMonth, monthOf, today, type Month } from '../../domain/dates';
import { formatMoney, parseTypedAmount } from '../../domain/money';
import type { BudgetStatus } from '../../domain/budgets';
import type { Category, Id } from '../../domain/model';
import type { BudgetView } from '../../data/repository';

const STATUS: Record<BudgetStatus, { label: string; text: string; bar: string }> = {
  onTrack: { label: 'En camino', text: 'text-muted', bar: 'bg-accent' },
  near: { label: 'Cerca', text: 'text-warn', bar: 'bg-warn' },
  over: { label: 'Superado', text: 'text-danger', bar: 'bg-danger' },
};

/**
 * The percentage as shown, rounded down: it never claims 85 % or more before *Cerca*. The
 * status still goes by the exact amounts.
 */
const shownPercent = (percent: number) => `${Math.floor(percent)} %`;

/** Más → Presupuestos: the current month's budgets with their spending, and adding one. */
export function Budgets() {
  const month = monthOf(today());
  const view = useRepoQuery((r) => r.budgets(month), [month]);
  const available = useRepoQuery((r) => r.budgetableCategories(month), [month]);
  const [adding, setAdding] = useState(false);
  const close = () => setAdding(false);
  const addButton = (variant: 'primary' | 'secondary') => (
    <Button variant={variant} onClick={() => setAdding(true)}>
      Añadir presupuesto
    </Button>
  );

  return (
    <>
      <PageHeader title="Presupuestos" back="/mas" />
      {view && available && (
        <div className="flex flex-col gap-4 px-4 pb-4">
          <p className="text-center font-medium capitalize">{formatMonth(month)}</p>
          {view.budgets.length === 0 ? (
            <>
              <EmptyState title="Aún no hay presupuestos">
                Pon un límite mensual a las categorías de gasto que quieras vigilar y verás cuánto llevas cada mes.
              </EmptyState>
              <div className="flex justify-center">{addButton('primary')}</div>
            </>
          ) : (
            <>
              <Totals {...view.totals} />
              <ul aria-label="Presupuestos" className="flex flex-col gap-3">
                {view.budgets.map((budget) => (
                  <BudgetCard key={budget.category.id} budget={budget} today={view.today} />
                ))}
              </ul>
              {available.length > 0 && addButton('secondary')}
            </>
          )}
        </div>
      )}

      <Sheet open={adding} onClose={close} title="Añadir presupuesto">
        {adding && available && <AddBudgetForm categories={available} month={month} onDone={close} />}
      </Sheet>
    </>
  );
}

function Totals({ budgeted, spent, remaining }: { budgeted: number; spent: number; remaining: number }) {
  return (
    <Card>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-muted">Presupuestado</dt>
          <dd className="tabular-nums" data-testid="budgets-budgeted">{formatMoney(budgeted)}</dd>
        </div>
        <div>
          <dt className="text-muted">Gastado</dt>
          <dd className="tabular-nums" data-testid="budgets-spent">{formatMoney(spent)}</dd>
        </div>
        <div>
          <dt className="text-muted">Queda</dt>
          {remaining < 0 ? (
            <dd className="tabular-nums text-danger" data-testid="budgets-remaining">{formatMoney(-remaining)} por encima</dd>
          ) : (
            <dd className="tabular-nums" data-testid="budgets-remaining">{formatMoney(remaining)}</dd>
          )}
        </div>
      </dl>
    </Card>
  );
}

/** Spent / limit, the percentage and a bar with the "today" marker (the month's pace) when there's one. */
function BudgetCard({ budget, today }: { budget: BudgetView; today: number | null }) {
  const { category, limit, spent, percent, status } = budget;
  const style = STATUS[status];
  return (
    <li className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-center gap-3">
        <IconBadge icon={category.icon} color={category.color} size={36} />
        <span className="min-w-0 flex-1 truncate">{category.name}</span>
        <span className={`shrink-0 text-sm font-medium ${style.text}`} data-testid="budget-status">
          {style.label}
        </span>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-2 text-sm">
        <span className="tabular-nums" data-testid="budget-spent">
          {formatMoney(spent)} <span className="text-muted">/ {formatMoney(limit)}</span>
        </span>
        <span className="tabular-nums text-muted" data-testid="budget-percent">
          {shownPercent(percent)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`Gastado en ${category.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.floor(percent))}
        aria-valuetext={shownPercent(percent)}
        className="relative mt-2 h-2 rounded-full bg-card-2"
      >
        <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${Math.min(100, percent)}%` }} />
        {today !== null && (
          <div
            data-testid="today-marker"
            title="Hoy"
            className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-text"
            style={{ left: `${today * 100}%` }}
          />
        )}
      </div>
    </li>
  );
}

/** Picks an expense category without a budget and types its monthly limit, from this month on. */
function AddBudgetForm({ categories, month, onDone }: { categories: Category[]; month: Month; onDone: () => void }) {
  const repo = useRepo();
  const [categoryId, setCategoryId] = useState<Id | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const amount = parseTypedAmount(text);
    if (categoryId === null) setError('Elige una categoría.');
    else if (amount === null || amount <= 0) setError('Escribe un límite mayor que 0, por ejemplo 300 o 1.500.');
    else {
      await repo.setBudgetLimit(categoryId, amount);
      onDone();
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <CategoryGrid
        categories={categories}
        value={categoryId}
        onPick={(id) => {
          setCategoryId(id);
          setError(null);
        }}
      />
      <label className="flex flex-col gap-1 text-sm text-muted">
        Límite mensual
        <input
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          inputMode="decimal"
          placeholder="0,00"
          autoComplete="off"
          className="min-h-11 rounded-xl border border-line bg-card-2 px-3 text-base text-text tabular-nums outline-none focus:border-accent"
        />
        <span className="text-xs">A partir de {formatMonth(month)}.</span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit">Añadir presupuesto</Button>
    </form>
  );
}
