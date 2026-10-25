import type { Cents } from './money';
import { addMonths, monthOf, type Month } from './dates';
import type { Id, Transaction } from './model';
import { spendingByCategory } from './budgets';

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

/**
 * Whether a transaction is "sin categoría": an imported expense or income without a category.
 * Transfers and balance adjustments never have one, so they aren't.
 */
export const isUncategorized = (tx: Transaction) => tx.source === 'import' && tx.type !== 'transfer' && tx.categoryId === null;

/** One entry of a month's spending: a category, or the uncategorized expenses ("Sin categoría"). */
export interface SpendingEntry {
  /** Null for "Sin categoría". */
  categoryId: Id | null;
  /** Above 0. */
  amount: Cents;
  /** amount / total × 100, unrounded. */
  percent: number;
}

export interface MonthSpending {
  /** Highest first. */
  entries: SpendingEntry[];
  /** The sum of the entries. */
  total: Cents;
}

/**
 * Where a month's money went, for Análisis → Gastos: each category's spending as budgets
 * measure it (expenses − income, by transaction date), leaving out the categories whose
 * spending is 0 or negative, plus the uncategorized expenses as one entry. Transfers and
 * balance adjustments never count. Ties keep the order of `categoryIds`, "Sin categoría" last.
 */
export function monthSpending(transactions: Transaction[], month: Month, categoryIds: Id[] = []): MonthSpending {
  const spent = [...spendingByCategory(transactions, month)].map(([categoryId, amount]) => ({ categoryId: categoryId as Id | null, amount }));
  const uncategorized = transactions
    .filter((tx) => isUncategorized(tx) && tx.type === 'expense' && monthOf(tx.date) === month)
    .reduce((sum, tx) => sum + tx.amount, 0);
  spent.push({ categoryId: null, amount: uncategorized });

  const rank = (id: Id | null) => {
    const index = id === null ? -1 : categoryIds.indexOf(id);
    return index === -1 ? categoryIds.length : index;
  };
  const kept = spent.filter((entry) => entry.amount > 0).sort((a, b) => b.amount - a.amount || rank(a.categoryId) - rank(b.categoryId));
  const total = kept.reduce((sum, entry) => sum + entry.amount, 0);
  return { entries: kept.map((entry) => ({ ...entry, percent: (entry.amount * 100) / total })), total };
}

/** One month of Análisis → Mensual: its `monthSummary`. */
export interface MonthlyEntry {
  month: Month;
  income: Cents;
  expenses: Cents;
  /** income − expenses: negative when more went out than came in. */
  net: Cents;
  /** The current month, still under way. */
  inProgress: boolean;
}

/**
 * Income and expenses of each of the `count` months ending at `currentMonth`, oldest first,
 * as `monthSummary` counts them. The months before `firstMonth`, the first one with an
 * imported transaction, are left out, so the series starts where the data starts; with no
 * data (null) it's empty.
 */
export function monthlySeries(transactions: Transaction[], currentMonth: Month, count: number, firstMonth: Month | null): MonthlyEntry[] {
  if (firstMonth === null || firstMonth > currentMonth) return [];
  const from = addMonths(currentMonth, 1 - count);
  const first = firstMonth > from ? firstMonth : from;

  const entries: MonthlyEntry[] = [];
  for (let month = first; month <= currentMonth; month = addMonths(month, 1)) {
    const { income, expenses, savings } = monthSummary(transactions, month);
    entries.push({ month, income, expenses, net: savings, inProgress: month === currentMonth });
  }
  return entries;
}
