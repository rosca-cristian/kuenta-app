import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { Button } from '../../ui/components';
import { IconBadge } from '../../ui/icons';
import { Money, usePrivacyMode } from '../../lib/money';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { addDays, formatDate, type IsoDate } from '../../domain/dates';
import { formatTypedAmount, parseTypedAmount, type Cents } from '../../domain/money';
import { allocateReimbursement } from '../../domain/reimbursements';
import type { Id } from '../../domain/model';
import type { ReimbursementCandidate, TransactionView } from '../../data/repository';
import { transactionTitle } from './titles';

/** How many days further back each "Ver gastos anteriores" looks, as the repository's window. */
const MORE_DAYS = 30;

const partHint = 'Escribe un importe, por ejemplo 9,95.';

/**
 * A ticked expense. Its part is the one typed by hand, if any; else, in privacy mode, the part
 * it already had (`kept`), which the field doesn't show; else the allocation's.
 */
interface Ticked {
  candidate: ReimbursementCandidate;
  /** The user typed in its field: `text` is the part, or, left empty, the allocation's (or the kept one). */
  typed: boolean;
  text: string;
  kept: Cents | null;
}

/**
 * "Es un reembolso": the expenses an imported income probably pays back (the 30 days up to it,
 * closest first, or older ones), to tick and give each a part, filled oldest first by what's
 * left of the income. Saving replaces the income's links; "Quitar reembolso" removes them.
 */
export function ReimbursementForm({ income, onDone }: { income: TransactionView; onDone: () => void }) {
  const repo = useRepo();
  // In privacy mode the parts start empty rather than giving the amounts away; left empty, they keep their part.
  const hidden = usePrivacyMode();
  const [text, setText] = useState('');
  const [before, setBefore] = useState<IsoDate | undefined>(undefined);
  const candidates = useRepoQuery((r) => r.reimbursementCandidates(income.id, { text, before }), [income.id, text, before]);
  const [ticked, setTicked] = useState<Map<Id, Ticked> | null>(null);
  const [busy, setBusy] = useState(false);

  // Once the candidates first load, the expenses it already pays back start ticked with their parts.
  if (ticked === null && candidates) {
    const linked = candidates.filter((candidate) => candidate.part > 0);
    setTicked(
      new Map(
        linked.map((candidate) => [
          candidate.transaction.id,
          hidden
            ? { candidate, typed: false, text: '', kept: candidate.part }
            : { candidate, typed: true, text: formatTypedAmount(candidate.part), kept: null },
        ]),
      ),
    );
  }
  const picked = ticked ?? new Map<Id, Ticked>();

  // The latest of what's left, for the ticked ones still listed.
  const latest = new Map((candidates ?? []).map((candidate) => [candidate.transaction.id, candidate]));
  const entries = [...picked.values()].map((entry) => ({ ...entry, candidate: latest.get(entry.candidate.transaction.id) ?? entry.candidate }));

  // A typed part that isn't an amount is refused; one typed empty falls back on the kept or allocated part.
  const typedParts: Record<Id, Cents> = {};
  const invalid = new Set<Id>();
  for (const { candidate, typed, text: partText, kept } of entries) {
    const id = candidate.transaction.id;
    if (typed && partText.trim() !== '') {
      const amount = parseTypedAmount(partText);
      if (amount === null || amount < 0) invalid.add(id);
      else typedParts[id] = amount;
    } else if (kept !== null) {
      typedParts[id] = kept;
    }
  }
  const expenses = entries.map(({ candidate }) => ({ id: candidate.transaction.id, date: candidate.transaction.date, left: candidate.left }));
  const { parts, remainder } = allocateReimbursement(income.amount, expenses, typedParts);
  const spread = income.amount - remainder;

  /** Why a ticked expense's part can't be saved, if it can't. */
  function errorOf(candidate: ReimbursementCandidate) {
    const id = candidate.transaction.id;
    if (invalid.has(id)) return partHint;
    const part = parts[id];
    if (part > candidate.left) return { what: 'del gasto', left: candidate.left };
    const leftOfIncome = income.amount - (spread - part);
    if (part > 0 && part > leftOfIncome) return { what: 'del ingreso', left: Math.max(0, leftOfIncome) };
    return null;
  }
  const hasErrors = entries.some(({ candidate }) => errorOf(candidate) !== null);

  function toggle(candidate: ReimbursementCandidate) {
    const next = new Map(picked);
    if (next.has(candidate.transaction.id)) next.delete(candidate.transaction.id);
    else next.set(candidate.transaction.id, { candidate, typed: false, text: '', kept: null });
    setTicked(next);
  }

  function type(id: Id, value: string) {
    const next = new Map(picked);
    next.set(id, { ...next.get(id)!, typed: true, text: value });
    setTicked(next);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (hasErrors || busy) return;
    setBusy(true);
    await repo.setReimbursements(
      income.id,
      entries.map(({ candidate }) => ({ expenseId: candidate.transaction.id, amount: parts[candidate.transaction.id] })),
    );
    onDone();
  }

  async function remove() {
    setBusy(true);
    await repo.setReimbursements(income.id, []);
    onDone();
  }

  // The ticked expenses the search hides stay on top, so their parts can still be seen and changed.
  const listed = candidates ?? [];
  const shown = [...entries.map((entry) => entry.candidate).filter((candidate) => !latest.has(candidate.transaction.id)), ...listed];

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        {transactionTitle(income)} · {formatDate(income.date)} · <Money cents={income.amount} sign="+" className="tabular-nums text-income" />
      </p>

      <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-card-2 pl-3 text-muted focus-within:border-accent">
        <Search size={18} className="shrink-0" aria-hidden />
        <input
          type="search"
          aria-label="Buscar gastos"
          placeholder="Buscar comercio, nota o concepto"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="min-h-11 min-w-0 flex-1 bg-transparent text-base text-text outline-none"
        />
      </label>

      {candidates && shown.length === 0 && (
        <p className="text-sm text-muted">{text.trim() === '' ? 'No hay gastos por devolver en estas fechas.' : 'Ningún gasto coincide.'}</p>
      )}
      <ul className="overflow-hidden rounded-2xl border border-line" aria-label="Gastos">
        {shown.map((candidate) => {
          const tx = candidate.transaction;
          const entry = picked.get(tx.id);
          const error = entry ? errorOf(candidate) : null;
          const name = transactionTitle(tx);
          return (
            <li key={tx.id} className="border-b border-line bg-card-2 last:border-b-0">
              <label className="flex min-h-16 items-center gap-3 px-3 py-2">
                <input type="checkbox" checked={entry !== undefined} onChange={() => toggle(candidate)} className="size-5 shrink-0 accent-accent" aria-label={name} />
                <IconBadge icon={tx.category?.icon} color={tx.category?.color} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{name}</span>
                  <span className="block truncate text-xs text-muted">
                    {formatDate(tx.date)} · {tx.category?.name ?? 'Sin categoría'}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <Money cents={tx.amount} sign="−" className="block tabular-nums" />
                  {candidate.left !== tx.amount && (
                    <span className="block text-xs text-muted">
                      queda <Money cents={candidate.left} />
                    </span>
                  )}
                </span>
              </label>
              {entry && (
                <div className="px-3 pb-3">
                  <label className="flex items-center justify-between gap-3 text-sm text-muted">
                    Parte
                    <input
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label={`Parte de ${name}`}
                      value={entry.typed ? entry.text : hidden ? '' : formatTypedAmount(parts[tx.id] ?? 0)}
                      placeholder={hidden ? (entry.kept !== null ? 'Sin cambios' : 'Automática') : '0,00'}
                      onChange={(event) => type(tx.id, event.target.value)}
                      className="min-h-11 w-32 rounded-xl border border-line bg-card px-3 text-right text-base text-text tabular-nums outline-none focus:border-accent"
                    />
                  </label>
                  {error && (
                    <p role="alert" className="mt-1 text-sm text-danger">
                      {typeof error === 'string' ? (
                        error
                      ) : (
                        <>
                          No puede ser más de lo que queda {error.what} (<Money cents={error.left} />)
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Button type="button" variant="ghost" onClick={() => setBefore(addDays(before ?? income.date, -MORE_DAYS))}>
        Ver gastos anteriores
      </Button>

      <p className="text-sm" data-testid="reimbursement-split" aria-live="polite">
        Repartido <Money cents={spread} className="tabular-nums" /> · Queda como ingreso <Money cents={remainder} className="tabular-nums" />
      </p>

      <Button type="submit" disabled={busy || hasErrors || ticked === null}>
        Guardar
      </Button>
      {income.reimbursement !== null && (
        <Button type="button" variant="danger" onClick={remove} disabled={busy}>
          Quitar reembolso
        </Button>
      )}
    </form>
  );
}
