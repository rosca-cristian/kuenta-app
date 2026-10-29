import { addMonths, daysInMonth, monthOf, type Month } from './dates';
import type { Category, Id, Transaction } from './model';

/** The days "A partir del día" accepts. */
export const NEXT_MONTH_DAYS = { min: 1, max: 31 } as const;

/** Whether `day` is a day "A partir del día" accepts: a whole number from 1 to 31. */
export const isNextMonthDay = (day: number) => Number.isInteger(day) && day >= NEXT_MONTH_DAYS.min && day <= NEXT_MONTH_DAYS.max;

/**
 * The month a transaction counts in for income and spending: the next one for an imported
 * income in an income category with `nextMonthFromDay` set (a salary paid on the last days of
 * the month, for the month after), when it arrives on that day or later; its own month for
 * everything else, expenses and transfers included. A day past the month's last one counts as
 * its last day, so "a partir del día 31" means the 30th in November and the 28th in February.
 */
export function countingMonthOf(tx: Pick<Transaction, 'type' | 'source' | 'date' | 'categoryId'>, categoriesById: Map<Id, Category>): Month {
  const month = monthOf(tx.date);
  if (tx.type !== 'income' || tx.source !== 'import' || tx.categoryId === null) return month;
  const category = categoriesById.get(tx.categoryId);
  if (category?.kind !== 'income' || category.nextMonthFromDay === null) return month;
  return Number(tx.date.slice(8, 10)) >= Math.min(category.nextMonthFromDay, daysInMonth(month)) ? addMonths(month, 1) : month;
}

/**
 * The transactions as income and spending count them by month: each one that counts in another
 * month than its own (`countingMonthOf`) dated the first day of that month, so every month's
 * figure (Inicio's summary, Análisis, budgets, subscriptions) takes it there. The others are
 * left as they are. Balances, the forecast and Movimientos never use this: they keep the bank's date.
 */
export function inCountingMonths<T extends Transaction>(transactions: T[], categoriesById: Map<Id, Category>): T[] {
  return transactions.map((tx) => {
    const month = countingMonthOf(tx, categoriesById);
    return month === monthOf(tx.date) ? tx : { ...tx, date: `${month}-01` };
  });
}
