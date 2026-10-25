import type { Cents } from './money';
import { addMonths, daysInMonth, monthOf, type IsoDate, type Month } from './dates';
import { signedAmount, type Account, type Transaction } from './model';

/** One point of Análisis → Patrimonio. */
export interface NetWorthPoint {
  month: Month;
  /** The month's last day, or today for the current month. */
  date: IsoDate;
  /** Every account's balance on that date, opening balances, archived and non-imported accounts included. */
  netWorth: Cents;
}

/**
 * Net worth at the end of each of the last `count` months ending at today's, oldest first:
 * the sum of every account's opening balance and its transactions up to the month's last day,
 * the current month's being today. Months before the first transaction are left out, so with
 * no transactions it's empty. Transfers move money between the accounts, so they don't change
 * it; balance adjustments do.
 */
export function netWorthSeries(accounts: Account[], transactions: Transaction[], date: IsoDate, count = 12): NetWorthPoint[] {
  const first = transactions.reduce<IsoDate | null>((oldest, tx) => (oldest === null || tx.date < oldest ? tx.date : oldest), null);
  if (first === null) return [];
  const opening = accounts.reduce((sum, account) => sum + account.openingBalance, 0);
  const ids = new Set(accounts.map((account) => account.id));
  /** What a transaction adds to the total: its signed amount on each of the accounts it touches. */
  const delta = (tx: Transaction) =>
    (ids.has(tx.accountId) ? signedAmount(tx, tx.accountId) : 0) +
    (tx.toAccountId !== null && ids.has(tx.toAccountId) ? signedAmount(tx, tx.toAccountId) : 0);
  const currentMonth = monthOf(date);
  const points: NetWorthPoint[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const month = addMonths(currentMonth, -back);
    if (month < monthOf(first)) continue;
    const end = back === 0 ? date : `${month}-${daysInMonth(month)}`;
    const netWorth = transactions.reduce((sum, tx) => (tx.date <= end ? sum + delta(tx) : sum), opening);
    points.push({ month, date: end, netWorth });
  }
  return points;
}

