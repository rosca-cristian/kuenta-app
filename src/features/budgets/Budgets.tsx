import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Choice, EmptyState, MonthSelector, PageHeader, formatPercent } from '../../ui/components';
import { Sheet } from '../../ui/Sheet';
import { IconBadge } from '../../ui/icons';
import { CategoryGrid } from '../../ui/pickers';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { formatMonth, monthOf, today, type Month } from '../../domain/dates';
import { formatMoney, formatTypedAmount, parseTypedAmount } from '../../domain/money';
import type { BudgetStatus } from '../../domain/budgets';
import type { Category, Id } from '../../domain/model';
import type { BudgetView } from '../../data/repository';

const STATUS: Record<BudgetStatus, { label: string; text: string; bar: string }> = {
  onTrack: { label: 'En camino', text: 'text-muted', bar: 'bg-accent' },
  near: { label: 'Cerca', text: 'text-warn', bar: 'bg-warn' },
  over: { label: 'Superado', text: 'text-danger', bar: 'bg-danger' },
};

/** The filter's *En camino* is every budget not *Superado*, *Cerca* included. */
type Filter = 'all' | 'over' | 'notOver';

const FILTERS: Record<Filter, string> = { all: 'Todos', over: 'Superados', notOver: 'En camino' };

const FILTERED_OUT: Record<Exclude<Filter, 'all'>, string> = {
  over: 'Ningún presupuesto superado este mes.',
  notOver: 'Ningún presupuesto en camino este mes.',
};

const shows = (filter: Filter, budget: BudgetView) => filter === 'all' || (filter === 'over') === (budget.status === 'over');

const limitHint = 'Escribe un límite mayor que 0, por ejemplo 300 o 1.500.';

/** The sheet adds a budget, or edits one "a partir de" the selected month. */
type Editing = { mode: 'add' } | { mode: 'edit'; budget: BudgetView };

/**
 * Más → Presupuestos: a month's budgets (the current month or an earlier one) with their
 * spending, and adding, changing or removing one from that month on. Inicio's alert opens
 * it with `?filtro=superados`, showing only the budgets over.
 */
export function Budgets() {
  const currentMonth = monthOf(today());
  const [params] = useSearchParams();
  const [month, setMonth] = useState(currentMonth);
  const [filter, setFilter] = useState<Filter>(() => (params.get('filtro') === 'superados' ? 'over' : 'all'));
  const view = useRepoQuery((r) => r.budgets(month), [month]);
  const available = useRepoQuery((r) => r.budgetableCategories(month), [month]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const close = () => setEditing(null);
  const addButton = (variant: 'primary' | 'secondary') => (
    <Button variant={variant} onClick={() => setEditing({ mode: 'add' })}>
      Añadir presupuesto
    </Button>
  );
  const shown = view?.budgets.filter((budget) => shows(filter, budget)) ?? [];

  return (
    <>
      <PageHeader title="Presupuestos" back="/mas" />
      <MonthSelector month={month} onChange={setMonth} max={currentMonth} />
      {view && available && (
        <div className="flex flex-col gap-4 px-4 pb-4">
          {view.budgets.length === 0 ? (
            <>
              <EmptyState title={month === currentMonth ? 'Aún no hay presupuestos' : 'No había presupuestos este mes'}>
                Pon un límite mensual a las categorías de gasto que quieras vigilar y verás cuánto llevas cada mes.
              </EmptyState>
              {available.length > 0 && <div className="flex justify-center">{addButton('primary')}</div>}
            </>
          ) : (
            <>
              <Totals {...view.totals} />
              <Choice legend="Mostrar" legendHidden name="budget-filter" value={filter} options={FILTERS} onChange={setFilter} />
              {filter !== 'all' && shown.length === 0 ? (
                <p className="rounded-2xl border border-line bg-card px-4 py-3 text-sm text-muted">{FILTERED_OUT[filter]}</p>
              ) : (
                <ul aria-label="Presupuestos" className="flex flex-col gap-3">
                  {shown.map((budget) => (
                    <BudgetCard
                      key={budget.category.id}
                      budget={budget}
                      today={view.today}
                      onEdit={() => setEditing({ mode: 'edit', budget })}
                    />
                  ))}
                </ul>
              )}
              {available.length > 0 && addButton('secondary')}
            </>
          )}
        </div>
      )}

      <Sheet open={editing !== null} onClose={close} title={editing?.mode === 'edit' ? `A partir de ${formatMonth(month)}` : 'Añadir presupuesto'}>
        {editing?.mode === 'add' && available && <AddBudgetForm categories={available} month={month} onDone={close} />}
        {editing?.mode === 'edit' && <EditBudgetForm key={editing.budget.category.id} budget={editing.budget} month={month} onDone={close} />}
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

/**
 * Spent / limit, the percentage and a bar with the "today" marker (the month's pace) when
 * there's one. Tapping it edits the budget.
 */
function BudgetCard({ budget, today, onEdit }: { budget: BudgetView; today: number | null; onEdit: () => void }) {
  const { category, limit, spent, percent, status } = budget;
  const style = STATUS[status];
  return (
    <li>
      <button onClick={onEdit} className="block w-full rounded-2xl border border-line bg-card p-4 text-left active:bg-card-2">
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
            {formatPercent(percent)}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={`Gastado en ${category.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.floor(percent))}
          aria-valuetext={formatPercent(percent)}
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
      </button>
    </li>
  );
}

function LimitInput({ value, onChange, month }: { value: string; onChange: (value: string) => void; month: Month }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-muted">
      Límite mensual
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="decimal"
        placeholder="0,00"
        autoComplete="off"
        className="min-h-11 rounded-xl border border-line bg-card-2 px-3 text-base text-text tabular-nums outline-none focus:border-accent"
      />
      <span className="text-xs">A partir de {formatMonth(month)}: ese mes y los siguientes; los anteriores no cambian.</span>
    </label>
  );
}

/** Picks an expense category without a budget that month and types its monthly limit, from that month on. */
function AddBudgetForm({ categories, month, onDone }: { categories: Category[]; month: Month; onDone: () => void }) {
  const repo = useRepo();
  const [categoryId, setCategoryId] = useState<Id | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const amount = parseTypedAmount(text);
    if (categoryId === null) setError('Elige una categoría.');
    else if (amount === null || amount <= 0) setError(limitHint);
    else {
      await repo.setBudgetLimit(categoryId, amount, month);
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
      <LimitInput
        value={text}
        month={month}
        onChange={(value) => {
          setText(value);
          setError(null);
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit">Añadir presupuesto</Button>
    </form>
  );
}

/**
 * Changes a budget's limit, or removes it, from the selected month on; earlier months keep
 * theirs. A category made an income one since can only have its budget removed.
 */
function EditBudgetForm({ budget, month, onDone }: { budget: BudgetView; month: Month; onDone: () => void }) {
  const repo = useRepo();
  const { category, limit } = budget;
  const [text, setText] = useState(() => formatTypedAmount(limit));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isExpense = category.kind === 'expense';

  async function save(event: FormEvent) {
    event.preventDefault();
    const amount = parseTypedAmount(text);
    if (amount === null || amount <= 0) {
      setError(limitHint);
      return;
    }
    setBusy(true);
    await repo.setBudgetLimit(category.id, amount, month);
    onDone();
  }

  async function remove() {
    setBusy(true);
    await repo.setBudgetLimit(category.id, 0, month);
    onDone();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <IconBadge icon={category.icon} color={category.color} size={44} />
        <span className="min-w-0 flex-1 truncate font-medium">{category.name}</span>
      </div>
      {isExpense ? (
        <LimitInput
          value={text}
          month={month}
          onChange={(value) => {
            setText(value);
            setError(null);
          }}
        />
      ) : (
        <p className="text-sm text-muted">«{category.name}» ya no es una categoría de gasto: solo puedes quitar su presupuesto.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {isExpense && (
        <Button type="submit" disabled={busy}>
          Guardar
        </Button>
      )}
      <Button type="button" variant="danger" onClick={remove} disabled={busy}>
        Quitar presupuesto
      </Button>
    </form>
  );
}
