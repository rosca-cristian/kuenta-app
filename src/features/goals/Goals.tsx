import { useState, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, Choice, EmptyState, MonthSelector, PageHeader } from '../../ui/components';
import { Sheet } from '../../ui/Sheet';
import { IconBadge, colorFor } from '../../ui/icons';
import { ColorPicker, IconPicker } from '../../ui/pickers';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { formatMonth, monthOf, today, type Month } from '../../domain/dates';
import { formatMoney, formatTypedAmount, parseTypedAmount } from '../../domain/money';
import type { Id } from '../../domain/model';
import type { GoalSaveResult, GoalView } from '../../data/repository';

const targetHint = 'Escribe un objetivo mayor que 0, por ejemplo 3.000 o 450,50.';

/** The percentage as shown, rounded down: it never claims 100 % before the goal is reached. */
const shownPercent = (percent: number) => `${Math.floor(percent)} %`;

/** The sheet shows the editor of a goal (a new one when `goal` is null) or the confirmation to delete it. */
type Editing = { mode: 'edit'; goal: GoalView | null } | { mode: 'delete'; goal: GoalView };

/**
 * Más → Objetivos: each goal's progress, which is its account's balance today, with how much
 * to save per month when it has a target month; creating, editing, archiving and deleting them.
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
      Nuevo objetivo
    </Button>
  );

  return (
    <>
      <PageHeader title="Objetivos" back="/mas" />
      {goals && accounts && (
        <div className="flex flex-col gap-4 px-4 pb-4">
          {active.length === 0 ? (
            <>
              <EmptyState title={archived.length > 0 ? 'No hay objetivos activos' : 'Aún no hay objetivos'}>
                Elige una cuenta y cuánto quieres tener en ella: su saldo es el progreso, así que cada transferencia a la cuenta lo hace
                avanzar.
              </EmptyState>
              {accounts.length > 0 && <div className="flex justify-center">{newButton('primary')}</div>}
            </>
          ) : (
            <>
              <GoalList title="Objetivos" goals={active} onEdit={edit} />
              {accounts.length > 0 ? (
                newButton('secondary')
              ) : (
                <p className="text-center text-sm text-muted">Cada cuenta ya tiene un objetivo.</p>
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
                Archivados ({archived.length})
                <ChevronDown size={16} className={`transition-transform ${showArchived ? 'rotate-180' : ''}`} aria-hidden />
              </button>
              {showArchived && <GoalList title="Archivados" goals={archived} onEdit={edit} />}
            </section>
          )}
        </div>
      )}

      <Sheet
        open={editing !== null}
        onClose={close}
        title={!editing ? '' : editing.mode === 'delete' ? 'Borrar objetivo' : editing.goal ? 'Editar objetivo' : 'Nuevo objetivo'}
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
            {formatMoney(current)} <span className="text-muted">/ {formatMoney(target)}</span>
          </span>
          <span className="tabular-nums text-muted" data-testid="goal-percent">
            {shownPercent(percent)}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={`Progreso de ${name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.floor(percent))}
          aria-valuetext={shownPercent(percent)}
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
            {plan.kind === 'save' ? `ahorra ${formatMoney(plan.perMonth)}/mes` : `Fecha superada · faltan ${formatMoney(plan.missing)}`}
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
  const [name, setName] = useState(goal?.name ?? '');
  const [text, setText] = useState(goal ? formatTypedAmount(goal.target) : '');
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
    const target = parseTypedAmount(text);
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
      else setError(`Esa cuenta ya tiene el objetivo «${result.existing.name}».`);
    }
  }

  async function toggleArchived(target: GoalView) {
    setBusy(true);
    const result: GoalSaveResult = await repo.setGoalArchived(target.id, !target.archived);
    setBusy(false);
    if (result.ok) onDone();
    else if (result.reason === 'taken') {
      setError(
        `«${target.account.name}» ya tiene el objetivo «${result.existing.name}». Archívalo o pasa este a otra cuenta para desarchivarlo.`,
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
          placeholder="0,00"
          autoComplete="off"
          className={`${inputClass} tabular-nums`}
        />
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
            <span className="shrink-0 text-sm tabular-nums text-muted">{formatMoney(option.balance)}</span>
          </button>
        ))}
        <span className="text-xs text-muted">El progreso es el saldo de la cuenta. Cada cuenta puede tener un solo objetivo.</span>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <IconPicker value={shownIcon} color={shownColor} onChange={changed(setIcon)} />
      <ColorPicker value={shownColor} onChange={changed(setColor)} />

      <Button type="submit" disabled={busy}>
        {goal ? 'Guardar' : 'Crear objetivo'}
      </Button>
      {goal && (
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => toggleArchived(goal)}>
            {goal.archived ? 'Desarchivar objetivo' : 'Archivar objetivo'}
          </Button>
          <Button type="button" variant="danger" disabled={busy} onClick={() => onDelete(goal)}>
            Borrar objetivo
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
