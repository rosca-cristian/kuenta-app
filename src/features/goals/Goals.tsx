import { useState, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, Card, Choice, EmptyState, MonthSelector, PageHeader, formatPercent } from '../../ui/components';
import { Sheet } from '../../ui/Sheet';
import { IconBadge, colorFor } from '../../ui/icons';
import { ColorPicker, IconPicker } from '../../ui/pickers';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { formatMonth, monthOf, today, type Month } from '../../domain/dates';
import { formatTypedAmount, parseTypedAmount } from '../../domain/money';
import { Money, usePrivacyMode } from '../../lib/money';
import type { Cents } from '../../domain/money';
import type { SavingsMonth } from '../../domain/savings';
import type { Id } from '../../domain/model';
import type { GoalSaveResult, GoalView, SavingsView } from '../../data/repository';

const targetHint = 'Escribe un objetivo mayor que 0, por ejemplo 3.000 o 450,50.';

const savingsHint = 'Escribe un ahorro mayor que 0, por ejemplo 300 o 1.500.';

/** The percentage as shown, rounded down: it never claims 100 % before the goal is reached. */
/** The sheet shows the editor of a goal (a new one when `goal` is null) or the confirmation to delete it. */
type Editing = { mode: 'edit'; goal: GoalView | null } | { mode: 'delete'; goal: GoalView };

/**
 * Más → Objetivos: first the monthly savings target ("Ahorro mensual") with this month's
 * progress and the history, then the goals ("Metas de ahorro"): each one's progress, which is
 * its account's balance today, with how much to save per month when it has a target month;
 * creating, editing, archiving and deleting them.
 */
export function Goals() {
  const goals = useRepoQuery((r) => r.listGoals());
  const accounts = useRepoQuery((r) => r.goalAccounts());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const close = () => setEditing(null);
  const edit = (goal: GoalView | null) => setEditing({ mode: 'edit', goal });
  const active = goals?.filter((goal) => !goal.archived) ?? [];
  const archived = goals?.filter((goal) => goal.archived) ?? [];
  const newButton = (variant: 'primary' | 'secondary') => (
    <Button variant={variant} onClick={() => edit(null)}>
      Nueva meta
    </Button>
  );

  return (
    <>
      <PageHeader title="Objetivos" back="/mas" />
      <div className="flex flex-col gap-6 px-4 pb-4">
        <MonthlySavings />
        {goals && accounts && (
          <section className="flex flex-col gap-4">
            <h2 className="font-medium">Metas de ahorro</h2>
            {active.length === 0 ? (
              <>
                <EmptyState title={archived.length > 0 ? 'No hay metas activas' : 'Aún no hay metas'}>
                  Elige una cuenta y cuánto quieres tener en ella: su saldo es el progreso, así que cada transferencia a la cuenta lo hace
                  avanzar.
                </EmptyState>
                {accounts.length > 0 && <div className="flex justify-center">{newButton('primary')}</div>}
              </>
            ) : (
              <>
                <GoalList title="Metas de ahorro" goals={active} onEdit={edit} />
                {accounts.length > 0 ? (
                  newButton('secondary')
                ) : (
                  <p className="text-center text-sm text-muted">Cada cuenta ya tiene una meta.</p>
                )}
              </>
            )}
            {archived.length > 0 && (
              <section>
                <button
                  type="button"
                  aria-expanded={showArchived}
                  onClick={() => setShowArchived(!showArchived)}
                  className="flex min-h-11 items-center gap-1 px-1 text-sm font-medium text-muted"
                >
                  Archivadas ({archived.length})
                  <ChevronDown size={16} className={`transition-transform ${showArchived ? 'rotate-180' : ''}`} aria-hidden />
                </button>
                {showArchived && <GoalList title="Archivadas" goals={archived} onEdit={edit} />}
              </section>
            )}
          </section>
        )}
      </div>

      <Sheet
        open={editing !== null}
        onClose={close}
        title={!editing ? '' : editing.mode === 'delete' ? 'Borrar meta' : editing.goal ? 'Editar meta' : 'Nueva meta'}
      >
        {editing?.mode === 'edit' && (
          <GoalForm
            key={editing.goal?.id ?? 'new'}
            goal={editing.goal}
            onDone={close}
            onDelete={(goal) => setEditing({ mode: 'delete', goal })}
          />
        )}
        {editing?.mode === 'delete' && (
          <DeleteGoal key={editing.goal.id} goal={editing.goal} onCancel={() => edit(editing.goal)} onDone={close} />
        )}
      </Sheet>
    </>
  );
}

/**
 * The monthly savings target: this month's savings against it, the history of the last
 * months and the streak, or what it is and a button to set it. The sheet sets, changes or
 * removes it from this month on.
 */
function MonthlySavings() {
  const month = monthOf(today());
  const view = useRepoQuery((r) => r.savings(month), [month]);
  const [editing, setEditing] = useState(false);
  const close = () => setEditing(false);
  if (!view) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-medium">Ahorro mensual</h2>
      {view.target === null ? (
        <Card className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted">Elige cuánto quieres ahorrar cada mes y Kuenta te dirá si lo vas consiguiendo.</p>
          <Button onClick={() => setEditing(true)}>Elegir ahorro mensual</Button>
        </Card>
      ) : (
        <>
          <SavingsCard view={view} onEdit={() => setEditing(true)} />
          {view.history.length > 0 && <SavingsHistory history={view.history} streak={view.streak} />}
        </>
      )}

      <Sheet open={editing} onClose={close} title="Ahorro mensual">
        {editing && <SavingsForm target={view.target} onDone={close} />}
      </Sheet>
    </section>
  );
}

/**
 * "Llevas X de Y", the percentage, a bar with the "today" marker (the month's pace) and the
 * status: what's left, *Conseguido*, or that the month is below 0. Tapping it edits the target.
 */
function SavingsCard({ view, onEdit }: { view: Exclude<SavingsView, { target: null }>; onEdit: () => void }) {
  const { month, target, saved, percent, reached, today: marker } = view;
  return (
    <button onClick={onEdit} className="block w-full rounded-2xl border border-line bg-card p-4 text-left active:bg-card-2">
      <div className="flex items-baseline justify-between gap-2">
        <span>{formatMonth(month)}</span>
        <span className="text-sm tabular-nums text-muted" data-testid="savings-percent">
          {formatPercent(percent)}
        </span>
      </div>
      <div className="mt-1 text-sm tabular-nums" data-testid="savings-progress">
        Llevas <Money cents={saved} /> <span className="text-muted">de <Money cents={target} /></span>
      </div>
      <div
        role="progressbar"
        aria-label="Ahorrado este mes"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.floor(percent))}
        aria-valuetext={formatPercent(percent)}
        className="relative mt-2 h-2 rounded-full bg-card-2"
      >
        <div className={`h-full rounded-full ${reached ? 'bg-income' : 'bg-accent'}`} style={{ width: `${Math.min(100, percent)}%` }} />
        {marker !== null && (
          <div
            data-testid="today-marker"
            title="Hoy"
            className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-text"
            style={{ left: `${marker * 100}%` }}
          />
        )}
      </div>
      {saved < 0 ? (
        <div className="mt-2 text-sm text-danger" data-testid="savings-status">
          Vas por debajo de 0
        </div>
      ) : reached ? (
        <div className="mt-2 text-sm font-medium text-income" data-testid="savings-status">
          Conseguido
        </div>
      ) : (
        <div className="mt-2 text-sm tabular-nums text-muted" data-testid="savings-status">
          Te faltan <Money cents={target - saved} />
        </div>
      )}
    </button>
  );
}

const MARKS: Record<SavingsMonth['status'], { mark: string; title: string; className: string }> = {
  met: { mark: '✓', title: 'Conseguido', className: 'text-income' },
  missed: { mark: '✗', title: 'No conseguido', className: 'text-danger' },
  inProgress: { mark: 'en curso', title: 'En curso', className: 'text-muted' },
};

/** The months with a target, newest first, each with its savings, its target then and ✓, ✗ or "en curso"; and the streak. */
function SavingsHistory({ history, streak }: { history: SavingsMonth[]; streak: number }) {
  return (
    <Card>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-medium">Historial</h3>
        {streak > 0 && (
          <span className="text-sm text-income" data-testid="savings-streak">
            {streak === 1 ? '1 mes seguido' : `${streak} meses seguidos`}
          </span>
        )}
      </div>
      <ul aria-label="Historial" className="flex flex-col">
        {history.map(({ month, saved, target, status }) => (
          <li key={month} className="flex min-h-11 items-center gap-3 border-t border-line py-2 text-sm first:border-t-0">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{formatMonth(month)}</span>
              <span className="truncate text-xs tabular-nums" data-testid="savings-month">
                <Money cents={saved} /> <span className="text-muted">/ <Money cents={target} /></span>
              </span>
            </span>
            <span className={`shrink-0 text-right ${MARKS[status].className}`} title={MARKS[status].title} data-testid="savings-mark">
              {MARKS[status].mark}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Sets the monthly target from this month on, or changes or removes it ("Quitar ahorro
 * mensual"); earlier months keep theirs.
 */
function SavingsForm({ target, onDone }: { target: Cents | null; onDone: () => void }) {
  const repo = useRepo();
  // In privacy mode the target starts empty rather than giving it away; saving it empty is
  // refused like any other invalid target, so it can't change the stored one.
  const hidden = usePrivacyMode();
  const [text, setText] = useState(() => (hidden || target === null ? '' : formatTypedAmount(target)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    const amount = parseTypedAmount(text);
    if (amount === null || amount <= 0) {
      setError(savingsHint);
      return;
    }
    setBusy(true);
    await repo.setSavingsTarget(amount);
    onDone();
  }

  async function remove() {
    setBusy(true);
    await repo.setSavingsTarget(0);
    onDone();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-muted">
        Ahorrar al mes
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
        <span className="text-xs">
          {target === null
            ? 'Lo que ingresas menos lo que gastas cada mes, como en Inicio.'
            : 'Se aplica todos los meses desde este; los anteriores mantienen el suyo.'}
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        Guardar
      </Button>
      {target !== null && (
        <Button type="button" variant="danger" onClick={remove} disabled={busy}>
          Quitar ahorro mensual
        </Button>
      )}
    </form>
  );
}

function GoalList({ title, goals, onEdit }: { title: string; goals: GoalView[]; onEdit: (goal: GoalView) => void }) {
  return (
    <ul aria-label={title} className="flex flex-col gap-3">
      {goals.map((goal) => (
        <GoalCard key={goal.id} goal={goal} onEdit={() => onEdit(goal)} />
      ))}
    </ul>
  );
}

/**
 * Current / target, the percentage and a bar in the goal's colour, full and *Conseguido* once
 * reached; below it, how much to save per month or that the target month passed. Tapping it
 * edits the goal.
 */
function GoalCard({ goal, onEdit }: { goal: GoalView; onEdit: () => void }) {
  const { name, icon, color, account, current, target, targetMonth, percent, reached, plan } = goal;
  const accountName = account.archived ? `${account.name} (archivada)` : account.name;
  return (
    <li>
      <button onClick={onEdit} className="block w-full rounded-2xl border border-line bg-card p-4 text-left active:bg-card-2">
        <div className="flex items-center gap-3">
          <IconBadge icon={icon} color={color} size={36} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{name}</span>
            <span className="truncate text-xs text-muted">
              {targetMonth ? `${accountName} · para ${formatMonth(targetMonth)}` : accountName}
            </span>
          </span>
          {reached && (
            <span className="shrink-0 text-sm font-medium text-income" data-testid="goal-reached">
              Conseguido
            </span>
          )}
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-2 text-sm">
          <span className="tabular-nums" data-testid="goal-progress">
            <Money cents={current} /> <span className="text-muted">/ <Money cents={target} /></span>
          </span>
          <span className="tabular-nums text-muted" data-testid="goal-percent">
            {formatPercent(percent)}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={`Progreso de ${name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.floor(percent))}
          aria-valuetext={formatPercent(percent)}
          className="mt-2 h-2 rounded-full bg-card-2"
        >
          <div
            className={`h-full rounded-full ${reached ? 'bg-income' : ''}`}
            style={{ width: `${reached ? 100 : Math.min(100, percent)}%`, background: reached ? undefined : colorFor(color) }}
          />
        </div>
        {/* An archived goal is no longer pursued: no amount to save. */}
        {plan && !goal.archived && (
          <div className={`mt-2 text-sm tabular-nums ${plan.kind === 'overdue' ? 'text-warn' : 'text-muted'}`} data-testid="goal-plan">
            {plan.kind === 'save' ? (
              <>
                ahorra <Money cents={plan.perMonth} />
                /mes
              </>
            ) : (
              <>
                Fecha superada · faltan <Money cents={plan.missing} />
              </>
            )}
          </div>
        )}
      </button>
    </li>
  );
}

/**
 * Every field of a goal, new (`goal` null) or not: name, target, optional target month,
 * account, icon and colour. A new goal's icon and colour follow its account's until the user
 * picks others. An existing goal can also be archived, unarchived or deleted from here.
 */
function GoalForm({ goal, onDone, onDelete }: { goal: GoalView | null; onDone: () => void; onDelete: (goal: GoalView) => void }) {
  const repo = useRepo();
  const accounts = useRepoQuery((r) => r.goalAccounts(goal?.id), [goal?.id]);
  // In privacy mode an existing goal's target starts empty rather than giving it away, and
  // left empty it keeps the stored one, so the other fields can still be edited.
  const hidden = usePrivacyMode();
  const [keepsTarget] = useState(hidden && goal !== null);
  const [name, setName] = useState(goal?.name ?? '');
  const [text, setText] = useState(goal && !keepsTarget ? formatTypedAmount(goal.target) : '');
  const [targetMonth, setTargetMonth] = useState<Month | null>(goal?.targetMonth ?? null);
  const [accountId, setAccountId] = useState<Id | null>(goal?.accountId ?? null);
  // Null follows the chosen account.
  const [icon, setIcon] = useState<string | null>(goal?.icon ?? null);
  const [color, setColor] = useState<string | null>(goal?.color ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const account = accounts?.find((option) => option.id === accountId);
  const shownIcon = icon ?? account?.icon ?? 'piggy-bank';
  const shownColor = color ?? account?.color ?? 'green';
  const changed = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setError(null);
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const target = keepsTarget && goal && text.trim() === '' ? goal.target : parseTypedAmount(text);
    if (name.trim() === '') setError('Escribe un nombre.');
    else if (target === null || target <= 0) setError(targetHint);
    else if (!accountId) setError('Elige una cuenta.');
    else {
      setBusy(true);
      const draft = { name, target, targetMonth, accountId, icon: shownIcon, color: shownColor };
      const result = goal ? await repo.updateGoal(goal.id, draft) : await repo.createGoal(draft);
      setBusy(false);
      if (result.ok) onDone();
      else if (result.reason === 'empty') setError('Escribe un nombre.');
      else setError(`Esa cuenta ya tiene la meta «${result.existing.name}».`);
    }
  }

  async function toggleArchived(target: GoalView) {
    setBusy(true);
    const result: GoalSaveResult = await repo.setGoalArchived(target.id, !target.archived);
    setBusy(false);
    if (result.ok) onDone();
    else if (result.reason === 'taken') {
      setError(
        `«${target.account.name}» ya tiene la meta «${result.existing.name}». Archívala o pasa esta a otra cuenta para desarchivarla.`,
      );
    }
  }

  const inputClass = 'min-h-11 rounded-xl border border-line bg-card-2 px-3 text-base text-text outline-none focus:border-accent';

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <IconBadge icon={shownIcon} color={shownColor} size={44} />
        <label className="flex flex-1 flex-col gap-1 text-sm text-muted">
          Nombre
          <input value={name} onChange={(event) => changed(setName)(event.target.value)} placeholder="Viaje a Japón" className={inputClass} />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm text-muted">
        Objetivo
        <input
          value={text}
          onChange={(event) => changed(setText)(event.target.value)}
          inputMode="decimal"
          placeholder={keepsTarget ? 'Sin cambios' : '0,00'}
          autoComplete="off"
          className={`${inputClass} tabular-nums`}
        />
        {keepsTarget && <span className="text-xs">Déjalo vacío para mantener el objetivo actual.</span>}
      </label>

      <TargetMonthPicker value={targetMonth} onChange={changed(setTargetMonth)} />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-muted">Cuenta</legend>
        {accounts?.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === accountId}
            onClick={() => changed(setAccountId)(option.id)}
            className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-left ${
              option.id === accountId ? 'bg-accent/20 ring-1 ring-accent' : 'bg-card-2'
            }`}
          >
            <IconBadge icon={option.icon} color={option.color} size={32} />
            <span className="min-w-0 flex-1 truncate">{option.archived ? `${option.name} (archivada)` : option.name}</span>
            <span className="shrink-0 text-sm tabular-nums text-muted"><Money cents={option.balance} /></span>
          </button>
        ))}
        <span className="text-xs text-muted">El progreso es el saldo de la cuenta. Cada cuenta puede tener una sola meta.</span>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <IconPicker value={shownIcon} color={shownColor} onChange={changed(setIcon)} />
      <ColorPicker value={shownColor} onChange={changed(setColor)} />

      <Button type="submit" disabled={busy}>
        {goal ? 'Guardar' : 'Crear meta'}
      </Button>
      {goal && (
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => toggleArchived(goal)}>
            {goal.archived ? 'Desarchivar meta' : 'Archivar meta'}
          </Button>
          <Button type="button" variant="danger" disabled={busy} onClick={() => onDelete(goal)}>
            Borrar meta
          </Button>
        </>
      )}
    </form>
  );
}

/**
 * "Sin fecha", or a month picked with `‹ junio 2027 ›`, starting from the current month (or
 * the goal's). Any month can be picked, past ones included.
 */
function TargetMonthPicker({ value, onChange }: { value: Month | null; onChange: (month: Month | null) => void }) {
  // The month to go back to after trying "Sin fecha".
  const [last, setLast] = useState<Month>(() => value ?? monthOf(today()));
  return (
    <div className="flex flex-col gap-1">
      <Choice
        legend="Para cuándo"
        name="target-month"
        value={value === null ? 'none' : 'month'}
        options={{ none: 'Sin fecha', month: 'Con fecha' }}
        onChange={(choice) => onChange(choice === 'none' ? null : last)}
      />
      {value !== null && (
        <MonthSelector
          month={value}
          onChange={(month) => {
            setLast(month);
            onChange(month);
          }}
        />
      )}
      <span className="text-xs text-muted">Con una fecha, Kuenta te dice cuánto ahorrar cada mes para llegar.</span>
    </div>
  );
}

/** Deleting a goal changes nothing else: its account and the account's transactions stay. */
function DeleteGoal({ goal, onCancel, onDone }: { goal: GoalView; onCancel: () => void; onDone: () => void }) {
  const repo = useRepo();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    await repo.deleteGoal(goal.id);
    onDone();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        ¿Borrar «{goal.name}»? La cuenta «{goal.account.name}» y sus movimientos no cambian.
      </p>
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button variant="danger" className="flex-1" onClick={confirm} disabled={busy}>
          Borrar
        </Button>
      </div>
    </div>
  );
}
