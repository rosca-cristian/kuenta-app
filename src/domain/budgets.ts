import type { Cents } from './money';
import { daysInMonth, monthOf, type IsoDate, type Month } from './dates';
import type { BudgetLimit, Id, Transaction } from './model';

/** *En camino* below 85 % of the limit, *Cerca* from 85 % to 100 %, *Superado* above 100 %. */
export type BudgetStatus = 'onTrack' | 'near' | 'over';

/** The share of the limit, in percent, from which a budget is *Cerca*. */
const NEAR_PERCENT = 85;

/** One budgeted category in a month. */
export interface MonthBudget {
  categoryId: Id;
  limit: Cents;
  /** Expenses − income in the category: negative when more came back than was spent. */
  spent: Cents;
  /** spent / limit × 100, unrounded; 0 when the spending is negative. */
  percent: number;
  status: BudgetStatus;
}

export interface BudgetTotals {
  /** The limits of the budgeted categories. */
  budgeted: Cents;
  /** The spending of the budgeted categories only. */
  spent: Cents;
  /** budgeted − spent: negative when overspent. */
  remaining: Cents;
}

export interface BudgetMonth {
  /** The categories with a limit above 0 that month, in the order given. */
  budgets: MonthBudget[];
  totals: BudgetTotals;
  /** Where the "today" marker sits, as a share of the month (day / days in month); null for other months. */
  today: number | null;
}

/** The category's limit in a month: the one with the latest starting month up to it, or 0 for none. */
export function limitFor(limits: BudgetLimit[], categoryId: Id, month: Month): Cents {
  let current: BudgetLimit | null = null;
  for (const limit of limits) {
    if (limit.categoryId !== categoryId || limit.fromMonth > month) continue;
    if (!current || limit.fromMonth > current.fromMonth) current = limit;
  }
  return current?.amount ?? 0;
}

/**
 * Each category's spending in a month by the transaction's date: its expenses minus its
 * income. Transfers, balance adjustments and uncategorized transactions never count.
 */
export function spendingByCategory(transactions: Transaction[], month: Month): Map<Id, Cents> {
  const spending = new Map<Id, Cents>();
  for (const tx of transactions) {
    if (tx.source !== 'import' || tx.type === 'transfer' || tx.categoryId === null || monthOf(tx.date) !== month) continue;
    const signed = tx.type === 'expense' ? tx.amount : -tx.amount;
    spending.set(tx.categoryId, (spending.get(tx.categoryId) ?? 0) + signed);
  }
  return spending;
}

/** By the share of the limit alone, compared in whole cents so 85 % and 100 % are exact. */
function statusOf(spent: Cents, limit: Cents): BudgetStatus {
  if (spent > limit) return 'over';
  return spent * 100 >= limit * NEAR_PERCENT ? 'near' : 'onTrack';
}

/**
 * The budgets of a month: one per category (of `categoryIds`, in that order) whose limit
 * that month is above 0, with its spending and status, plus the totals and, in the month
 * of `today`, the "today" marker.
 */
export function budgetMonth({
  month,
  categoryIds,
  limits,
  transactions,
  today,
}: {
  month: Month;
  categoryIds: Id[];
  limits: BudgetLimit[];
  transactions: Transaction[];
  today: IsoDate;
}): BudgetMonth {
  const spending = spendingByCategory(transactions, month);
  const budgets: MonthBudget[] = [];
  for (const categoryId of categoryIds) {
    const limit = limitFor(limits, categoryId, month);
    if (limit <= 0) continue;
    const spent = spending.get(categoryId) ?? 0;
    budgets.push({ categoryId, limit, spent, percent: (Math.max(0, spent) * 100) / limit, status: statusOf(spent, limit) });
  }
  const budgeted = budgets.reduce((sum, budget) => sum + budget.limit, 0);
  const spent = budgets.reduce((sum, budget) => sum + budget.spent, 0);
  return {
    budgets,
    totals: { budgeted, spent, remaining: budgeted - spent },
    today: monthOf(today) === month ? Number(today.slice(8, 10)) / daysInMonth(month) : null,
  };
}
