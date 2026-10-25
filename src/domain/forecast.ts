import type { Cents } from './money';
import { addMonths, daysInMonth, monthOf, type IsoDate, type Month } from './dates';
import type { Id, Transaction } from './model';

/** A charge a payee is expected to make in a month and hasn't made yet. */
export interface ExpectedCharge {
  payeeId: Id;
  /** The payee's expenses of the previous month. */
  amount: Cents;
}

/** The first day of the month from which the forecast is shown: one or two days of data would mislead. */
const FIRST_FORECAST_DAY = 3;

/** Each payee's imported expenses in a month. Transfers, balance adjustments and transactions without a payee never count. */
function expensesByPayee(transactions: Transaction[], month: Month): Map<Id, Cents> {
  const expenses = new Map<Id, Cents>();
  for (const tx of transactions) {
    if (tx.source !== 'import' || tx.type !== 'expense' || tx.payeeId === null || monthOf(tx.date) !== month) continue;
    expenses.set(tx.payeeId, (expenses.get(tx.payeeId) ?? 0) + tx.amount);
  }
  return expenses;
}

/**
 * The expected charges of a month: one per payee with an expense in each of the two
 * previous months and none yet in this one, for the previous month's expenses of that
 * payee (summed when there were several). `transactions` must span those three months.
 */
export function expectedCharges(transactions: Transaction[], month: Month): ExpectedCharge[] {
  const lastMonth = expensesByPayee(transactions, addMonths(month, -1));
  const monthBefore = expensesByPayee(transactions, addMonths(month, -2));
  const thisMonth = expensesByPayee(transactions, month);
  const charges: ExpectedCharge[] = [];
  for (const [payeeId, amount] of lastMonth) {
    if (monthBefore.has(payeeId) && !thisMonth.has(payeeId)) charges.push({ payeeId, amount });
  }
  return charges;
}

/**
 * Where the month's spending is heading on `today`: the expenses so far, without those of
 * the payees with an expected charge, per day elapsed times the days in the month, plus the
 * expected charges, rounded to the cent. Null for any month but today's and before the 3rd.
 * `transactions` must span the month and the two before it.
 */
export function monthForecast(transactions: Transaction[], month: Month, today: IsoDate): Cents | null {
  const day = Number(today.slice(8, 10));
  if (monthOf(today) !== month || day < FIRST_FORECAST_DAY) return null;
  const charges = expectedCharges(transactions, month);
  const expected = new Set(charges.map((charge) => charge.payeeId));
  let spent = 0;
  for (const tx of transactions) {
    if (tx.source !== 'import' || tx.type !== 'expense' || monthOf(tx.date) !== month) continue;
    // By definition these payees have no expense yet this month; kept apart so they never count twice.
    if (tx.payeeId !== null && expected.has(tx.payeeId)) continue;
    spent += tx.amount;
  }
  const pending = charges.reduce((sum, charge) => sum + charge.amount, 0);
  return Math.round((spent / day) * daysInMonth(month)) + pending;
}
