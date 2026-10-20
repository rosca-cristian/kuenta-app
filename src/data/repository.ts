import type { Cents } from '../domain/money';
import type { IsoDate, Month } from '../domain/dates';
import type { Gap } from '../domain/chain';
import type { ImportPlan } from '../domain/importPlan';
import type { MonthSummary } from '../domain/stats';
import type { Account, Category, Id, ImportBatch, Payee, Transaction } from '../domain/model';
import type { ReadError } from '../import/bbva/reader';

export interface AccountView extends Account {
  balance: Cents;
  isImportAccount: boolean;
}

export interface TransactionView extends Transaction {
  category: Category | null;
  payee: Payee | null;
  account: Account;
  toAccount: Account | null;
}

export interface Settings {
  onboardingDone: boolean;
  importAccountId: Id | null;
  persistRequested: boolean;
}

export interface ImportPreview {
  fileName: string;
  accountId: Id;
  plan: ImportPlan;
}

export type PreviewResult = { ok: true; preview: ImportPreview } | { ok: false; error: ReadError };

export interface BalanceCheck {
  /** The most recent "Disponible" on record. */
  bankBalance: Cents;
  /** The import account's balance in Kuenta. */
  appBalance: Cents;
  /** bankBalance − appBalance: 0 when they agree. */
  difference: Cents;
}

export interface ImportOutcome {
  batch: ImportBatch;
  check: BalanceCheck;
}

export interface HomeData {
  totalBalance: Cents;
  summary: MonthSummary;
  accounts: AccountView[];
  daysSinceLastImport: number | null;
  uncategorized: number;
  gaps: Gap[];
}

export interface TransactionChanges {
  categoryId?: Id | null;
  /** Empty clears the payee; otherwise an existing payee with the same normalized name is reused. */
  payeeName?: string;
  note?: string;
}

/** The only data interface screens use. */
export interface DataRepository {
  /** Called after every write. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;

  getSettings(): Promise<Settings>;
  setPersistRequested(): Promise<void>;
  /** Creates the import account and the starter categories. */
  completeOnboarding(input: { importAccountName: string }): Promise<void>;

  listAccounts(): Promise<AccountView[]>;
  listCategories(): Promise<Category[]>;

  /** Transactions of a month, newest first. */
  listTransactions(month: Month): Promise<TransactionView[]>;
  getTransaction(id: Id): Promise<TransactionView | null>;
  /** Only category, payee and note can change; amount, date and account come from the bank. */
  updateTransaction(id: Id, changes: TransactionChanges): Promise<void>;
  /** Balance adjustments can be deleted; imported transactions can't. */
  deleteAdjustment(id: Id): Promise<void>;
  /** Expense categories used on a date, most used first. */
  expenseCategoriesUsedOn(date: IsoDate): Promise<Id[]>;

  previewImport(file: Blob | ArrayBuffer, fileName: string): Promise<PreviewResult>;
  /** Imports the new rows of a preview, except the excluded fingerprints, in one transaction. */
  commitImport(preview: ImportPreview, options?: { exclude?: string[] }): Promise<ImportOutcome>;
  balanceCheck(): Promise<BalanceCheck | null>;
  /** Creates an uncategorized adjustment so the import account agrees with the bank. */
  createBalanceAdjustment(): Promise<void>;
  /** Imports, newest first, undone ones included. */
  listImports(): Promise<ImportBatch[]>;
  /** How many of an import's transactions the user edited since. */
  editedCountInImport(batchId: Id): Promise<number>;
  undoImport(batchId: Id): Promise<void>;

  home(month: Month): Promise<HomeData>;
}
