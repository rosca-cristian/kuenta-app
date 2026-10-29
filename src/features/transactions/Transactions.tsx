import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Search, SlidersHorizontal, X } from 'lucide-react';
import { Amount, Button, Choice, EmptyState, FilterChip, MonthSelector, PageHeader } from '../../ui/components';
import { IconBadge, TransferBadge } from '../../ui/icons';
import { useRepoQuery } from '../../lib/repo';
import { Money } from '../../lib/money';
import { PrivacyButton } from '../../ui/PrivacyButton';
import { formatDayHeader, formatMonth, monthOf, today, type Month } from '../../domain/dates';
import { listNet } from '../../domain/stats';
import type { TransactionFilter, TransactionView } from '../../data/repository';
import { EditTransactionSheet } from './EditTransactionSheet';
import { transactionTitle } from './titles';
import { ExportCsvButton } from './ExportCsvButton';
import { FiltersSheet } from './FiltersSheet';
import {
  filterParams,
  periodParam,
  textParam,
  TYPE_FILTER_NAMES,
  withFilter,
  withoutFilter,
  withPeriod,
  withText,
  type FilterField,
} from './filters';

/** How long typing pauses before the search goes into the URL. */
const SEARCH_DELAY_MS = 150;

/** A day section's height before it's laid out: its header and rows, so the scrollbar stays put. */
const dayHeight = (rows: number) => 24 + rows * 65;

/** The grey line under the title: category and account, or the accounts a transfer moves money between. */
function subtitle(tx: TransactionView): string {
  if (tx.type === 'transfer') return `${tx.account.name} → ${tx.toAccount?.name ?? ''}`;
  return `${tx.source === 'adjustment' ? 'Ajuste de saldo' : tx.category?.name ?? 'Sin categoría'} · ${tx.account.name}`;
}

/** The month a late salary counts in, as its row says it: "noviembre", or "enero 2027" in another year than its date's. */
function countingMonthName(tx: TransactionView, month: Month): string {
  const name = formatMonth(month);
  return month.slice(0, 4) === tx.date.slice(0, 4) ? name.split(' ')[0] : name;
}

/**
 * A row's amount, always the bank's: under it, "Reembolso" on an income that pays back expenses
 * and "Tu parte" on an expense paid back, what it really cost, and "Cuenta en noviembre" on an
 * income that counts in another month than its date's.
 */
function RowAmount({ tx }: { tx: TransactionView }) {
  if (tx.type === 'transfer') return <Amount cents={tx.amount} kind="neutral" className="text-muted" />;
  const amount = <Amount cents={tx.amount} kind={tx.type} />;
  if (!tx.reimbursement && !tx.countingMonth) return amount;
  return (
    <span className="flex shrink-0 flex-col items-end">
      {amount}
      {tx.reimbursement &&
        (tx.type === 'income' ? (
          <span className="rounded-full bg-card-2 px-1.5 text-xs text-muted" data-testid="reimbursement-mark">
            Reembolso
          </span>
        ) : (
          <span className="whitespace-nowrap text-xs text-muted" data-testid="row-your-share">
            Tu parte <Money cents={tx.amount - tx.reimbursement.paidBack} className="tabular-nums" />
          </span>
        ))}
      {tx.countingMonth && (
        <span className="whitespace-nowrap text-xs text-muted" data-testid="row-counting-month">
          Cuenta en {countingMonthName(tx, tx.countingMonth)}
        </span>
      )}
    </span>
  );
}

/**
 * Movimientos: a month's transactions, or all months', newest first, with a search and filters,
 * each shown as a removable chip, and how many match and their net. Its state lives in the URL
 * (see `filters.ts`), where Análisis and Inicio put a filter too.
 */
export function Transactions() {
  const [params, setParams] = useSearchParams();
  // Writes build on the newest parameters, even ones not rendered yet: a search's delayed
  // write and a tap on the period mustn't undo each other.
  const latest = useRef(params);
  useLayoutEffect(() => {
    latest.current = params;
  }, [params]);
  const update = useCallback(
    (change: (current: URLSearchParams) => URLSearchParams) => {
      latest.current = change(latest.current);
      setParams(latest.current, { replace: true });
    },
    [setParams],
  );
  const currentMonth = monthOf(today());
  const period = periodParam(params, currentMonth);
  const text = textParam(params);
  const filter = filterParams(params);
  const [editing, setEditing] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);
  const current = useRepoQuery((repo) => repo.listTransactions(period, { ...filter, text }), [period, filter, text]);
  // The list keeps the previous results while new ones load; the export waits for them.
  const transactions = useLatest(current);
  const search = useCallback((next: string) => update((current) => withText(current, next)), [update]);
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
      <PageHeader
        title="Movimientos"
        action={
          <div className="flex shrink-0 items-center">
            <PrivacyButton />
            <ExportCsvButton transactions={current} />
          </div>
        }
      />
      <div className="flex flex-col gap-2 px-4 pb-2">
        <SearchBox value={text} onChange={search} />
        <Choice
          legend="Periodo"
          legendHidden
          name="period"
          value={period === null ? 'all' : 'month'}
          options={{ month: 'Un mes', all: 'Todos los meses' }}
          onChange={(choice) => update((current) => withPeriod(current, choice === 'all' ? null : currentMonth))}
        />
      </div>
      {period !== null && <MonthSelector month={period} onChange={(next) => update((current) => withPeriod(current, next))} />}
      <FilterBar filter={filter} onOpen={() => setFiltering(true)} onRemove={(field) => update((current) => withoutFilter(current, field))} />
      {transactions && transactions.length > 0 && (
        <p className="px-5 pb-3 text-sm text-muted" data-testid="summary">
          {transactions.length === 1 ? '1 movimiento' : `${transactions.length} movimientos`} · neto{' '}
          <Money cents={listNet(transactions)} format="signed" className="tabular-nums" />
        </p>
      )}
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
          const net = listNet(txs);
          return (
            // Off-screen days aren't laid out, so a month of 500 transactions scrolls smoothly.
            <section key={date} style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${dayHeight(txs.length)}px` }}>
              <h2 className="flex justify-between px-1 pb-1 text-xs text-muted">
                <span>{formatDayHeader(date, period === null && date.slice(0, 4) !== currentMonth.slice(0, 4))}</span>
                <Money cents={net} format="signed" className="tabular-nums" />
              </h2>
              <ul className="overflow-hidden rounded-2xl border border-line bg-card">
                {txs.map((tx) => (
                  <li key={tx.id} className="border-b border-line last:border-b-0">
                    <button className="flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left active:bg-card-2" onClick={() => setEditing(tx.id)}>
                      {tx.type === 'transfer' ? <TransferBadge /> : <IconBadge icon={tx.category?.icon} color={tx.category?.color} />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{transactionTitle(tx)}</span>
                        <span className={`block truncate text-xs ${tx.category || tx.type === 'transfer' ? 'text-muted' : 'text-warn'}`}>
                          {subtitle(tx)}
                        </span>
                      </span>
                      <RowAmount tx={tx} />
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
      <FiltersSheet
        open={filtering}
        filter={filter ?? {}}
        onApply={(next) => {
          setFiltering(false);
          update((current) => withFilter(current, { ...next, payeeId: filter?.payeeId }));
        }}
        onClose={() => setFiltering(false)}
      />
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
  if (filter) hints.push(Object.keys(filter).length > 1 ? 'quita algún filtro' : 'quita el filtro');
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

/**
 * The "Filtros" button and a removable chip for each field of the URL's filter: category ("Sin
 * categoría"), payee, account and type; with two or more, "Quitar filtros" removes them all.
 * `onRemove` gets the field to remove, or none for all of them.
 */
function FilterBar({
  filter,
  onOpen,
  onRemove,
}: {
  filter: TransactionFilter | null;
  onOpen: () => void;
  onRemove: (field?: FilterField) => void;
}) {
  const names = useRepoQuery(async (repo) => {
    if (!filter) return {};
    const [accounts, categories, payees] = await Promise.all([
      filter.accountId === undefined ? [] : repo.listAccounts(),
      filter.categoryId === undefined ? [] : repo.listCategories({ withArchived: true }),
      filter.payeeId === undefined ? [] : repo.listPayees(),
    ]);
    return {
      account: accounts.find((account) => account.id === filter.accountId)?.name,
      category: categories.find((category) => category.id === filter.categoryId)?.name,
      payee: payees.find((payee) => payee.id === filter.payeeId)?.name,
    };
  }, [filter]);
  const chips: [FilterField, string][] = [];
  if (filter && names) {
    if (filter.categoryId !== undefined) chips.push(['categoryId', filter.categoryId === null ? 'Sin categoría' : names.category ?? 'Categoría borrada']);
    if (filter.payeeId !== undefined) chips.push(['payeeId', names.payee ?? 'Comercio borrado']);
    if (filter.accountId !== undefined) chips.push(['accountId', names.account ?? 'Cuenta borrada']);
    if (filter.type !== undefined) chips.push(['type', TYPE_FILTER_NAMES[filter.type]]);
  }
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
      <Button variant="secondary" className="flex shrink-0 items-center gap-2 text-sm" onClick={onOpen}>
        <SlidersHorizontal size={16} aria-hidden />
        Filtros
      </Button>
      {chips.map(([field, label]) => (
        <FilterChip key={field} label={label} onRemove={() => onRemove(field)} />
      ))}
      {chips.length >= 2 && (
        <Button variant="ghost" className="shrink-0 text-sm" onClick={() => onRemove()}>
          Quitar filtros
        </Button>
      )}
    </div>
  );
}
