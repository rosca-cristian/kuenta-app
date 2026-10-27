import type { Cents } from './money';
import type { IsoDate } from './dates';
import type { Id, Reimbursement, Transaction } from './model';

/** A ticked expense, as the allocation sees it. */
export interface AllocationExpense {
  id: Id;
  date: IsoDate;
  /** What's left of it to pay back: its amount minus the parts other incomes pay back. */
  left: Cents;
}

export interface Allocation {
  /** The part of the income each ticked expense gets, by expense id; 0 when nothing was left for it. */
  parts: Record<Id, Cents>;
  /** What stays as income: the income minus every part. Negative when the parts typed by hand add up to more. */
  remainder: Cents;
}

/**
 * Spreads an income over the ticked expenses. The parts typed by hand (`typed`, by expense id)
 * stay as they are; the income left after them fills the other expenses oldest first (by date,
 * then id), each up to the smaller of what's left of the expense and of the income.
 */
export function allocateReimbursement(income: Cents, expenses: AllocationExpense[], typed: Record<Id, Cents> = {}): Allocation {
  const parts: Record<Id, Cents> = {};
  let available = income;
  for (const expense of expenses) {
    if (!(expense.id in typed)) continue;
    parts[expense.id] = typed[expense.id];
    available -= typed[expense.id];
  }
  const oldestFirst = expenses
    .filter((expense) => !(expense.id in typed))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const expense of oldestFirst) {
    const part = Math.max(0, Math.min(expense.left, available));
    parts[expense.id] = part;
    available -= part;
  }
  return { parts, remainder: available };
}

/**
 * The transactions as income and spending count them: each expense smaller by the parts paid
 * back to it, and each income smaller by the parts it spreads over expenses (down to 0 for one
 * that pays back expenses whole). The other side of a link may be outside `transactions`, e.g.
 * in another month: an expense is still smaller by it. `links` must be live ones, whose income
 * and expense both still exist as such; a link counts only on the side of the right type.
 * Balances never use this: a reimbursement moves no money.
 */
export function netOfReimbursements<T extends Transaction>(transactions: T[], links: Reimbursement[]): T[] {
  const paidBack = new Map<Id, Cents>();
  const spread = new Map<Id, Cents>();
  for (const link of links) {
    paidBack.set(link.expenseId, (paidBack.get(link.expenseId) ?? 0) + link.amount);
    spread.set(link.incomeId, (spread.get(link.incomeId) ?? 0) + link.amount);
  }
  return transactions.map((tx) => {
    const part = tx.type === 'expense' ? paidBack.get(tx.id) : tx.type === 'income' ? spread.get(tx.id) : undefined;
    return part === undefined ? tx : { ...tx, amount: Math.max(0, tx.amount - part) };
  });
}

/**
 * What's left of an expense to pay back: its amount minus every live part paying it back, but
 * those of `exceptIncomeId`, whose parts are being edited.
 */
export function leftToPayBack(expense: Pick<Transaction, 'id' | 'amount'>, links: Reimbursement[], exceptIncomeId?: Id): Cents {
  return links
    .filter((link) => link.expenseId === expense.id && link.incomeId !== exceptIncomeId)
    .reduce((left, link) => left - link.amount, expense.amount);
}
