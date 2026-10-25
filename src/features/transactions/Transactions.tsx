import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Amount, EmptyState, FilterChip, MonthSelector, PageHeader } from '../../ui/components';
import { IconBadge, TransferBadge } from '../../ui/icons';
import { useRepoQuery } from '../../lib/repo';
import { formatDayHeader, monthOf, today } from '../../domain/dates';
import { formatSignedMoney } from '../../domain/money';
import { signedAmount } from '../../domain/model';
import type { TransactionFilter, TransactionView } from '../../data/repository';
import { EditTransactionSheet } from './EditTransactionSheet';
import { filterParams, monthParam, withMonth, withoutFilter } from './filters';

function title(tx: TransactionView): string {
  return tx.payee?.name || tx.note || tx.bankConcept || 'Movimiento';
}

/** The grey line under the title: category and account, or the accounts a transfer moves money between. */
function subtitle(tx: TransactionView): string {
  if (tx.type === 'transfer') return `${tx.account.name} → ${tx.toAccount?.name ?? ''}`;
  return `${tx.source === 'adjustment' ? 'Ajuste de saldo' : tx.category?.name ?? 'Sin categoría'} · ${tx.account.name}`;
}

/**
 * Movimientos: a month's transactions, newest first. Análisis and Inicio open it with a
 * month and a filter in the URL (see `filters.ts`), shown as a removable chip.
 */
export function Transactions() {
  const [params, setParams] = useSearchParams();
  const month = monthParam(params) ?? monthOf(today());
  const filter = filterParams(params);
  const [editing, setEditing] = useState<string | null>(null);
  const transactions = useRepoQuery((repo) => repo.listTransactions(month, filter ?? undefined), [month, filter]);

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
      <MonthSelector month={month} onChange={(next) => setParams(withMonth(params, next), { replace: true })} />
      {filter && <FilterLabel filter={filter} onRemove={() => setParams(withoutFilter(params), { replace: true })} />}
      {transactions &&
        transactions.length === 0 &&
        (filter ? (
          <EmptyState title="Ningún movimiento con este filtro este mes">Quita el filtro para ver todos los movimientos del mes.</EmptyState>
        ) : (
          <EmptyState title="No hay movimientos este mes">Importa el Excel de BBVA desde la pestaña Importar.</EmptyState>
        ))}
      <div className="flex flex-col gap-4 px-4 pb-4">
        {days.map(([date, txs]) => {
          const net = txs.reduce((sum, tx) => (tx.type === 'transfer' ? sum : sum + signedAmount(tx, tx.accountId)), 0);
          return (
            <section key={date}>
              <h2 className="flex justify-between px-1 pb-1 text-xs text-muted">
                <span>{formatDayHeader(date)}</span>
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
