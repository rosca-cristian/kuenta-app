import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Amount, EmptyState, MonthSelector, PageHeader } from '../../ui/components';
import { IconBadge } from '../../ui/icons';
import { useRepoQuery } from '../../lib/repo';
import { formatDayHeader, monthOf, today } from '../../domain/dates';
import { formatSignedMoney } from '../../domain/money';
import { signedAmount } from '../../domain/model';
import type { TransactionView } from '../../data/repository';
import { EditTransactionSheet } from './EditTransactionSheet';

function title(tx: TransactionView): string {
  return tx.payee?.name || tx.note || tx.bankConcept || 'Movimiento';
}

export function Transactions() {
  const [month, setMonth] = useState(monthOf(today()));
  const [editing, setEditing] = useState<string | null>(null);
  const transactions = useRepoQuery((repo) => repo.listTransactions(month), [month]);

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
      <MonthSelector month={month} onChange={setMonth} />
      {transactions && transactions.length === 0 && (
        <EmptyState title="No hay movimientos este mes">Importa el Excel de BBVA desde la pestaña Importar.</EmptyState>
      )}
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
                      <IconBadge icon={tx.category?.icon} color={tx.category?.color} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{title(tx)}</span>
                        <span className={`block truncate text-xs ${tx.category ? 'text-muted' : 'text-warn'}`}>
                          {tx.source === 'adjustment' ? 'Ajuste de saldo' : tx.category?.name ?? 'Sin categoría'} · {tx.account.name}
                        </span>
                      </span>
                      <Amount cents={tx.amount} kind={tx.type === 'income' ? 'income' : 'expense'} />
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
