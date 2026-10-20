import type { Cents } from './money';
import type { Month } from './dates';
import type { Transaction } from './model';

export interface MonthSummary {
  income: Cents;
  expenses: Cents;
  savings: Cents;
  /** (income − expenses) / income, or null when there is no income. */
  savingsRate: number | null;
}

/**
 * Income and expenses of a month. Transfers move money between the user's own
 * accounts and balance adjustments only correct balances, so neither counts.
 */
export function monthSummary(transactions: Transaction[], month: Month): MonthSummary {
  let income = 0;
  let expenses = 0;
  for (const tx of transactions) {
    if (tx.source !== 'import' || !tx.date.startsWith(month)) continue;
    if (tx.type === 'income') income += tx.amount;
    if (tx.type === 'expense') expenses += tx.amount;
  }
  const savings = income - expenses;
  return { income, expenses, savings, savingsRate: income > 0 ? savings / income : null };
}
