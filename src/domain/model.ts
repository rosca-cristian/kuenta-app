import type { Cents } from './money';
import type { IsoDate, Month } from './dates';

export type Id = string;

export type AccountType = 'bank' | 'savings' | 'investment' | 'other';

export interface Account {
  id: Id;
  name: string;
  type: AccountType;
  /** For the import account, derived from imports. For others, typed by the user. */
  openingBalance: Cents;
  color: string;
  icon: string;
  archived: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type CategoryKind = 'expense' | 'income';

export interface Category {
  id: Id;
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  order: number;
  archived: boolean;
  /**
   * Income categories only: an imported income in it that arrives on this day of the month or
   * later (1–31; past the month's last day, on its last day) counts in the next month, its
   * counting month (`countingMonthOf`). Null counts every income in its own month.
   */
  nextMonthFromDay: number | null;
}

export interface Payee {
  id: Id;
  name: string;
  normalized: string;
}

export type TxType = 'expense' | 'income' | 'transfer';

/** Each type's name in the Spanish UI and the CSV. */
export const TX_TYPE_NAMES: Record<TxType, string> = { expense: 'Gasto', income: 'Ingreso', transfer: 'Transferencia' };
export type TxSource = 'import' | 'adjustment';

export interface Transaction {
  id: Id;
  type: TxType;
  /** Always positive; the type gives the sign. */
  amount: Cents;
  /** The value date ("Fecha valor"). */
  date: IsoDate;
  accountId: Id;
  toAccountId: Id | null;
  categoryId: Id | null;
  payeeId: Id | null;
  note: string;
  source: TxSource;
  importBatchId: Id | null;
  importHash: string | null;
  bookingDate: IsoDate | null;
  bankConcept: string | null;
  bankMovement: string | null;
  /** The bank's running balance ("Disponible") right after this row. */
  bankBalance: Cents | null;
  /** When the user last changed category, payee or note, or made it a transfer or undid one. */
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuleMatch {
  field: 'concept' | 'movement' | 'conceptOrMovement';
  op: 'contains' | 'startsWith' | 'equals';
  /** Compared ignoring case and accents. */
  value: string;
  /** Charges (negative bank amount), credits (positive) or both. */
  direction: 'any' | 'out' | 'in';
}

/** What a rule sets: a category or a transfer account, never both, and optionally a payee name. */
export interface RuleActions {
  categoryId?: Id;
  /**
   * Makes the transaction a transfer with this account, in the direction of the bank's sign:
   * a charge goes from the import account to it, a credit comes from it to the import account.
   */
  transferAccountId?: Id;
  /** Creates or reuses the payee with this normalized name. */
  payeeName?: string;
}

export interface Rule {
  id: Id;
  name: string;
  /** The first enabled rule that matches, by order, wins. */
  order: number;
  enabled: boolean;
  match: RuleMatch;
  actions: RuleActions;
}

/**
 * A category's monthly limit in force from a month onwards, until the category's next one.
 * Setting a limit from a month replaces the one starting then and deletes the later ones.
 */
export interface BudgetLimit {
  id: Id;
  categoryId: Id;
  fromMonth: Month;
  /** 0 means no budget from that month. */
  amount: Cents;
}

/**
 * How much to save each month, in force from a month onwards until the next one: a month's
 * savings are its income minus its expenses, as Inicio counts them. Setting a target from a
 * month replaces the one starting then and deletes the later ones.
 */
export interface SavingsTarget {
  id: Id;
  fromMonth: Month;
  /** 0 means no target from that month. */
  amount: Cents;
}

/** An amount to save in one account; its progress is the account's balance. */
export interface Goal {
  id: Id;
  name: string;
  /** Above 0. */
  target: Cents;
  targetMonth: Month | null;
  /** At most one non-archived goal per account. */
  accountId: Id;
  icon: string;
  color: string;
  archived: boolean;
}

/**
 * A reimbursement: a part of an imported income (a received Bizum) linked to an imported
 * expense it pays back. The part makes the expense smaller, in the expense's month, and
 * isn't income; balances don't change. At most one per income and expense.
 */
export interface Reimbursement {
  id: Id;
  incomeId: Id;
  expenseId: Id;
  /** Above 0. An income's parts add up to its amount at most; an expense's, across incomes, too. */
  amount: Cents;
}

export interface ImportBatch {
  id: Id;
  importedAt: string;
  fileName: string;
  accountId: Id;
  dateFrom: IsoDate;
  dateTo: IsoDate;
  rows: number;
  created: number;
  skipped: number;
  bankBalance: Cents;
  appBalance: Cents;
  undone: boolean;
}

/** A row of the settings table: one key and its value (`docs/spec.md` §3 lists the keys). */
export interface Setting {
  key: string;
  value: unknown;
}

/** Signed effect of a transaction on an account's balance. */
export function signedAmount(tx: Pick<Transaction, 'type' | 'amount' | 'accountId' | 'toAccountId'>, accountId: Id): Cents {
  if (tx.type === 'transfer') {
    if (tx.toAccountId === accountId) return tx.amount;
    return tx.accountId === accountId ? -tx.amount : 0;
  }
  if (tx.accountId !== accountId) return 0;
  return tx.type === 'income' ? tx.amount : -tx.amount;
}
