import type { Cents } from './money';
import type { IsoDate } from './dates';

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
}

export interface Payee {
  id: Id;
  name: string;
  normalized: string;
}

export type TxType = 'expense' | 'income' | 'transfer';
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
  /** When the user last changed category, payee or note. */
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

export interface RuleActions {
  categoryId?: Id;
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

/** Signed effect of a transaction on an account's balance. */
export function signedAmount(tx: Pick<Transaction, 'type' | 'amount' | 'accountId' | 'toAccountId'>, accountId: Id): Cents {
  if (tx.type === 'transfer') {
    if (tx.toAccountId === accountId) return tx.amount;
    return tx.accountId === accountId ? -tx.amount : 0;
  }
  if (tx.accountId !== accountId) return 0;
  return tx.type === 'income' ? tx.amount : -tx.amount;
}
