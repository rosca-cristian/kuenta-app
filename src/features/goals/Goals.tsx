import { useState, type FormEvent } from 'react';
import { Button, EmptyState, PageHeader } from '../../ui/components';
import { Sheet } from '../../ui/Sheet';
import { IconBadge, colorFor } from '../../ui/icons';
import { ColorPicker, IconPicker } from '../../ui/pickers';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { formatMoney, parseTypedAmount } from '../../domain/money';
import type { Id } from '../../domain/model';
import type { AccountView, GoalView } from '../../data/repository';

const targetHint = 'Escribe un objetivo mayor que 0, por ejemplo 3.000 o 450,50.';

/** The percentage as shown, rounded down: it never claims 100 % before the goal is reached. */
const shownPercent = (percent: number) => `${Math.floor(percent)} %`;

/**
 * Más → Objetivos: each goal's progress, which is its account's balance today, and creating
 * one on an account that doesn't have one yet.
 */
export function Goals() {
  const goals = useRepoQuery((r) => r.listGoals());
  const accounts = useRepoQuery((r) => r.goalAccounts());
  const [creating, setCreating] = useState(false);
  const close = () => setCreating(false);
  const active = goals?.filter((goal) => !goal.archived) ?? [];
  const newButton = (variant: 'primary' | 'secondary') => (
    <Button variant={variant} onClick={() => setCreating(true)}>
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
              <EmptyState title="Aún no hay objetivos">
                Elige una cuenta y cuánto quieres tener en ella: su saldo es el progreso, así que cada transferencia a la cuenta lo hace
                avanzar.
              </EmptyState>
              {accounts.length > 0 && <div className="flex justify-center">{newButton('primary')}</div>}
            </>
          ) : (
            <>
              <ul aria-label="Objetivos" className="flex flex-col gap-3">
                {active.map((goal) => (
                  <GoalCard key={goal.id} goal={goal} />
                ))}
              </ul>
              {accounts.length > 0 ? (
                newButton('secondary')
              ) : (
                <p className="text-center text-sm text-muted">Cada cuenta ya tiene un objetivo.</p>
              )}
            </>
          )}
        </div>
      )}

      <Sheet open={creating} onClose={close} title="Nuevo objetivo">
        {creating && accounts && <GoalForm accounts={accounts} onDone={close} />}
      </Sheet>
    </>
  );
}

/** Current / target, the percentage and a bar in the goal's colour; full and *Conseguido* once reached. */
function GoalCard({ goal }: { goal: GoalView }) {
  const { name, icon, color, account, current, target, percent, reached } = goal;
  return (
    <li className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-center gap-3">
        <IconBadge icon={icon} color={color} size={36} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{name}</span>
          <span className="truncate text-xs text-muted">{account.archived ? `${account.name} (archivada)` : account.name}</span>
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
    </li>
  );
}

/**
 * Name, target and account of a new goal, with its icon and colour following the account's
 * until the user picks others.
 */
function GoalForm({ accounts, onDone }: { accounts: AccountView[]; onDone: () => void }) {
  const repo = useRepo();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [accountId, setAccountId] = useState<Id | null>(null);
  // Null follows the chosen account.
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const account = accounts.find((option) => option.id === accountId);
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
      const result = await repo.createGoal({ name, target, accountId, icon: shownIcon, color: shownColor });
      setBusy(false);
      if (result.ok) onDone();
      else if (result.reason === 'empty') setError('Escribe un nombre.');
      else setError(`Esa cuenta ya tiene el objetivo «${result.existing.name}».`);
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

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-muted">Cuenta</legend>
        {accounts.map((option) => (
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
            <span className="min-w-0 flex-1 truncate">{option.name}</span>
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
        Crear objetivo
      </Button>
    </form>
  );
}
