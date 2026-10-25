import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Search, X } from 'lucide-react';
import { Amount, Choice, EmptyState, FilterChip, MonthSelector, PageHeader } from '../../ui/components';
import { IconBadge, TransferBadge } from '../../ui/icons';
import { useRepoQuery } from '../../lib/repo';
import { formatDayHeader, monthOf, today, type Month } from '../../domain/dates';
import { formatSignedMoney } from '../../domain/money';
import { signedAmount } from '../../domain/model';
import type { TransactionFilter, TransactionView } from '../../data/repository';
import { EditTransactionSheet } from './EditTransactionSheet';
import { filterParams, periodParam, textParam, withoutFilter, withPeriod, withText } from './filters';

/** How long typing pauses before the search goes into the URL. */
const SEARCH_DELAY_MS = 150;

/** A day section's height before it's laid out: its header and rows, so the scrollbar stays put. */
const dayHeight = (rows: number) => 24 + rows * 65;

function title(tx: TransactionView): string {
  return tx.payee?.name || tx.note || tx.bankConcept || 'Movimiento';
}

/** The grey line under the title: category and account, or the accounts a transfer moves money between. */
function subtitle(tx: TransactionView): string {
  if (tx.type === 'transfer') return `${tx.account.name} → ${tx.toAccount?.name ?? ''}`;
  return `${tx.source === 'adjustment' ? 'Ajuste de saldo' : tx.category?.name ?? 'Sin categoría'} · ${tx.account.name}`;
}

/**
 * Movimientos: a month's transactions, or all months', newest first, with a search. Its state
 * lives in the URL (see `filters.ts`); Análisis and Inicio open it with a filter there, shown as a
 * removable chip.
 */
export function Transactions() {
  const [params, setParams] = useSearchParams();
  const currentMonth = monthOf(today());
  const period = periodParam(params, currentMonth);
  const text = textParam(params);
  const filter = filterParams(params);
  const [editing, setEditing] = useState<string | null>(null);
  const transactions = useLatest(
    useRepoQuery((repo) => repo.listTransactions(period, { ...filter, text }), [period, filter, text]),
  );
  const search = useCallback((next: string) => setParams((current) => withText(current, next), { replace: true }), [setParams]);
  const searching = text.trim() !== '' || filter !== null;

  const days = useMemo(() => {
    const groups = new Map<string, TransactionView[]>();
    for (const tx of transactions ?? []) {
      const day = groups.get(tx.date);
      if (day) day.push(tx);
      else groups.set(tx.date, [tx]);
    }
    return [...groups.entries()];
  }, [transactions]);

  return (
    <>
      <PageHeader title="Movimientos" />
      <div className="flex flex-col gap-2 px-4 pb-2">
        <SearchBox value={text} onChange={search} />
        <Choice
          legend="Periodo"
          legendHidden
          name="period"
          value={period === null ? 'all' : 'month'}
          options={{ month: 'Un mes', all: 'Todos los meses' }}
          onChange={(choice) => setParams(withPeriod(params, choice === 'all' ? null : currentMonth), { replace: true })}
        />
      </div>
      {period !== null && <MonthSelector month={period} onChange={(next) => setParams(withPeriod(params, next), { replace: true })} />}
      {filter && <FilterLabel filter={filter} onRemove={() => setParams(withoutFilter(params), { replace: true })} />}
      {transactions &&
        transactions.length === 0 &&
        (searching ? (
          <EmptyState title="Ningún movimiento coincide">{widenHint(period, text, filter)}</EmptyState>
        ) : period === null ? (
          <EmptyState title="Aún no hay movimientos">Importa el Excel de BBVA desde la pestaña Importar.</EmptyState>
        ) : (
          <EmptyState title="No hay movimientos este mes">Importa el Excel de BBVA desde la pestaña Importar.</EmptyState>
        ))}
      <div className="flex flex-col gap-4 px-4 pb-4">
        {days.map(([date, txs]) => {
          const net = txs.reduce((sum, tx) => (tx.type === 'transfer' ? sum : sum + signedAmount(tx, tx.accountId)), 0);
          return (
            // Off-screen days aren't laid out, so a month of 500 transactions scrolls smoothly.
            <section key={date} style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${dayHeight(txs.length)}px` }}>
              <h2 className="flex justify-between px-1 pb-1 text-xs text-muted">
                <span>{formatDayHeader(date, period === null && date.slice(0, 4) !== currentMonth.slice(0, 4))}</span>
                <span className="tabular-nums">{formatSignedMoney(net)}</span>
              </h2>
              <ul className="overflow-hidden rounded-2xl border border-line bg-card">
                {txs.map((tx) => (
                  <li key={tx.id} className="border-b border-line last:border-b-0">
                    <button className="flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left active:bg-card-2" onClick={() => setEditing(tx.id)}>
                      {tx.type === 'transfer' ? <TransferBadge /> : <IconBadge icon={tx.category?.icon} color={tx.category?.color} />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{title(tx)}</span>
                        <span className={`block truncate text-xs ${tx.category || tx.type === 'transfer' ? 'text-muted' : 'text-warn'}`}>
                          {subtitle(tx)}
                        </span>
                      </span>
                      {tx.type === 'transfer' ? (
                        <Amount cents={tx.amount} kind="neutral" className="text-muted" />
                      ) : (
                        <Amount cents={tx.amount} kind={tx.type === 'income' ? 'income' : 'expense'} />
                      )}
                      {tx.editedAt && <Check size={14} className="text-muted" aria-label="Revisado" />}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <EditTransactionSheet id={editing} onClose={() => setEditing(null)} />
    </>
  );
}

/**
 * The last loaded value, kept while the next one loads, so the list doesn't blink (and lose its
 * scroll) while the search changes.
 */
function useLatest<T>(value: T | undefined): T | undefined {
  const [latest, setLatest] = useState(value);
  if (value !== undefined && value !== latest) setLatest(value);
  return value ?? latest;
}

/** How to find more when nothing matches: all months, other words, no filter. */
function widenHint(period: Month | null, text: string, filter: TransactionFilter | null): string {
  const hints: string[] = [];
  if (period !== null) hints.push('busca en «Todos los meses»');
  if (text.trim() !== '') hints.push('prueba con otras palabras');
  if (filter) hints.push('quita el filtro');
  const sentence = hints.length > 1 ? `${hints.slice(0, -1).join(', ')} o ${hints[hints.length - 1]}` : hints[0] ?? '';
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/**
 * The search field. It shows what's typed at once and hands it on after a pause; it follows
 * `value` when that changes from elsewhere, such as the back button.
 */
function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  // The value the draft last agreed with: when `value` moves away from it, someone else changed it.
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft === synced) return;
    const timer = setTimeout(() => {
      setSynced(draft);
      onChange(draft);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, synced, onChange]);

  const clear = () => {
    setDraft('');
    setSynced('');
    onChange('');
  };

  return (
    <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-card pl-3 text-muted focus-within:border-accent">
      <Search size={18} className="shrink-0" aria-hidden />
      <input
        type="search"
        aria-label="Buscar movimientos"
        placeholder="Buscar comercio, nota o concepto"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="min-h-11 min-w-0 flex-1 bg-transparent text-base text-text outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {draft !== '' && (
        <button type="button" aria-label="Borrar búsqueda" className="flex size-11 shrink-0 items-center justify-center" onClick={clear}>
          <X size={18} aria-hidden />
        </button>
      )}
    </label>
  );
}

/** The chip describing the URL's filter: the category ("Sin categoría") and the payee it shows. */
function FilterLabel({ filter, onRemove }: { filter: TransactionFilter; onRemove: () => void }) {
  const names = useRepoQuery(async (repo) => {
    const [categories, payees] = await Promise.all([repo.listCategories(), filter.payeeId === undefined ? [] : repo.listPayees()]);
    return {
      category: categories.find((category) => category.id === filter.categoryId)?.name,
      payee: payees.find((payee) => payee.id === filter.payeeId)?.name,
    };
  }, [filter]);
  if (!names) return null;
  const parts: string[] = [];
  if (filter.categoryId !== undefined) parts.push(filter.categoryId === null ? 'Sin categoría' : names.category ?? 'Categoría borrada');
  if (filter.payeeId !== undefined) parts.push(names.payee ?? 'Comercio borrado');
  return (
    <div className="flex px-4 pb-3">
      <FilterChip label={parts.join(' · ')} onRemove={onRemove} />
    </div>
  );
}
