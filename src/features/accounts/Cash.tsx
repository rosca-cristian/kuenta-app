import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, PageHeader } from '../../ui/components';
import { IconBadge } from '../../ui/icons';
import { useRepoQuery } from '../../lib/repo';
import { Money } from '../../lib/money';
import { formatDate } from '../../domain/dates';
import type { CashExpenseView } from '../../data/repository';
import { CashExpenseSheet } from '../transactions/CashExpenseSheet';
import { EditTransactionSheet } from '../transactions/EditTransactionSheet';
import { transactionTitle } from '../transactions/titles';

/** How the cash pocket shows as a line among the accounts. */
export const CASH_LINE = { name: 'Efectivo', icon: 'banknote', color: 'lime' } as const;

/**
 * The "Efectivo" line among the accounts, in Inicio and Cuentas: the unspent cash, read-only.
 * Tapping it opens the cash screen.
 */
export function CashLine({ cents, size = 36, className = '' }: { cents: number; size?: number; className?: string }) {
  return (
    <Link to="/mas/cuentas/efectivo" className={`flex items-center gap-3 active:opacity-70 ${className}`} data-testid="cash-line">
      <IconBadge icon={CASH_LINE.icon} color={CASH_LINE.color} size={size} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{CASH_LINE.name}</span>
        <span className="text-xs text-muted">sin repartir</span>
      </span>
      <span className="shrink-0 tabular-nums" data-testid="cash-line-amount">
        <Money cents={cents} />
      </span>
    </Link>
  );
}

/**
 * Más → Cuentas → Efectivo: the unspent cash, the withdrawals that still have some, the latest
 * cash expenses and "Apuntar gasto en efectivo". Tapping a withdrawal or an expense opens its sheet.
 */
export function Cash() {
  const pocket = useRepoQuery((r) => r.cashPocket());
  const [noting, setNoting] = useState<CashExpenseView | 'new' | null>(null);
  const [withdrawal, setWithdrawal] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Efectivo" back="/mas/cuentas" />
      {pocket && (
        <div className="flex flex-col gap-4 px-4 pb-4">
          <Card>
            <p className="text-sm text-muted">Sin repartir</p>
            <p className="text-3xl font-semibold tabular-nums" data-testid="cash-total">
              <Money cents={pocket.total} />
            </p>
            <Button className="mt-3 w-full" onClick={() => setNoting('new')}>
              Apuntar gasto en efectivo
            </Button>
          </Card>

          <section>
            <h2 className="px-1 pb-1 text-sm font-medium text-muted">Retiradas con efectivo</h2>
            {pocket.withdrawals.length === 0 ? (
              <p className="px-1 text-sm text-muted">Ninguna retirada tiene efectivo sin repartir.</p>
            ) : (
              <ul aria-label="Retiradas con efectivo" className="overflow-hidden rounded-2xl border border-line bg-card">
                {pocket.withdrawals.map(({ transaction, left }) => (
                  <li key={transaction.id} className="border-b border-line last:border-b-0">
                    <button className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left active:bg-card-2" onClick={() => setWithdrawal(transaction.id)}>
                      <IconBadge icon={CASH_LINE.icon} color={CASH_LINE.color} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{transactionTitle(transaction)}</span>
                        <span className="block truncate text-xs text-muted">
                          {formatDate(transaction.date)} · <Money cents={transaction.amount} className="tabular-nums" />
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end">
                        <Money cents={left} className="tabular-nums" />
                        <span className="text-xs text-muted">quedan</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="px-1 pb-1 text-sm font-medium text-muted">Últimos gastos en efectivo</h2>
            {pocket.latest.length === 0 ? (
              <EmptyState title="Aún no hay gastos en efectivo">Apunta en qué gastas el efectivo que sacas del cajero.</EmptyState>
            ) : (
              <CashExpenseList title="Últimos gastos en efectivo" expenses={pocket.latest} onOpen={setNoting} />
            )}
          </section>
        </div>
      )}
      <CashExpenseSheet expense={noting} onClose={() => setNoting(null)} />
      <EditTransactionSheet id={withdrawal} onClose={() => setWithdrawal(null)} />
    </>
  );
}

/** Cash expenses, each with its category, date and amount, marked "Sin efectivo" when the cash can't pay it. */
export function CashExpenseList({ title, expenses, onOpen }: { title: string; expenses: CashExpenseView[]; onOpen: (expense: CashExpenseView) => void }) {
  return (
    <ul aria-label={title} className="overflow-hidden rounded-2xl border border-line bg-card">
      {expenses.map((expense) => {
        const categoryName = expense.category?.name ?? 'Categoría borrada';
        return (
          <li key={expense.id} className="border-b border-line last:border-b-0">
            <button className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left active:bg-card-2" onClick={() => onOpen(expense)}>
              <IconBadge icon={expense.category?.icon} color={expense.category?.color} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{expense.note || categoryName}</span>
                <span className="flex min-w-0 items-center gap-1 text-xs text-muted">
                  {expense.uncovered && (
                    <span className="shrink-0 rounded-full bg-card-2 px-1.5 text-warn" data-testid="uncovered-mark">
                      Sin efectivo
                    </span>
                  )}
                  <span className="truncate">
                    {expense.note ? `${categoryName} · ` : ''}
                    {formatDate(expense.date)}
                  </span>
                </span>
              </span>
              <Money cents={expense.amount} className="shrink-0 tabular-nums" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
