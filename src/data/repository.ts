import type { Cents } from '../domain/money';
import type { IsoDate, Month } from '../domain/dates';
import type { Gap } from '../domain/chain';
import type { ImportPlan } from '../domain/importPlan';
import type { MonthSummary } from '../domain/stats';
import type { Account, AccountType, Category, CategoryKind, Id, ImportBatch, Payee, Rule, RuleActions, RuleMatch, Transaction } from '../domain/model';
import type { ReadError } from '../import/bbva/reader';

export interface AccountView extends Account {
  balance: Cents;
  isImportAccount: boolean;
}

export interface AccountDraft {
  name: string;
  type: AccountType;
  /** A name from the icon set. */
  icon: string;
  /** A palette token. */
  color: string;
  /**
   * Non-imported accounts only: their balance before their first transaction. Defaults to 0
   * and may be negative. The import account's is derived from imports and can't be set.
   */
  openingBalance?: Cents;
}

export type AccountChanges = Partial<AccountDraft>;

/**
 * The outcome of creating or editing an account. It's refused when the name is empty, or
 * when another account (`existing`) already has it ignoring case and accents.
 */
export type AccountSaveResult =
  | { ok: true; id: Id }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'exists'; existing: Account };

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

export interface CommitImportOptions {
  /** Fingerprints of the new rows to leave out. */
  exclude?: string[];
  /**
   * Categories the user chose in the preview, by fingerprint (null for "Sin categoría").
   * They win over the plan's, and those transactions count as edited by the user, so rules
   * applied later never change them.
   */
  categories?: Record<string, Id | null>;
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
  /** The sum of every account's balance, archived ones included. */
  totalBalance: Cents;
  summary: MonthSummary;
  /** The non-archived accounts, in order. */
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
  /**
   * An account makes an imported transaction a transfer with it, in the direction of the
   * bank's sign ("Convertir en transferencia"); null makes a transfer an expense or income
   * again by that sign, uncategorized unless `categoryId` comes too ("Quitar transferencia").
   */
  transferAccountId?: Id | null;
}

export interface PayeeView extends Payee {
  transactionCount: number;
}

/**
 * The outcome of renaming a payee. It's refused when the name is empty, or when another
 * payee (`existing`) already has it ignoring case and accents.
 */
export type PayeeRenameResult = { ok: true } | { ok: false; reason: 'empty' } | { ok: false; reason: 'exists'; existing: Payee };

export interface CategoryDraft {
  name: string;
  kind: CategoryKind;
  /** A name from the icon set. */
  icon: string;
  /** A palette token. */
  color: string;
}

export type CategoryChanges = Partial<CategoryDraft>;

/**
 * The outcome of creating or editing a category. It's refused when the name is empty, or
 * when another category (`existing`) already has it ignoring case and accents.
 */
export type CategorySaveResult =
  | { ok: true; id: Id }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'exists'; existing: Category };

export interface CategoryUsage {
  /** Transactions with the category. */
  transactions: number;
  /** Rules whose action sets the category. */
  rules: number;
}

export interface RuleDraft {
  name: string;
  /** Defaults to true. */
  enabled?: boolean;
  /** Defaults: concept or movement, contains, any direction. */
  match: Partial<RuleMatch> & Pick<RuleMatch, 'value'>;
  actions: RuleActions;
}

/** What a rule, saved or not, would do on the imported transactions. */
export interface RulePreview {
  /** Imported transactions the rule's condition matches, edited or not. */
  matching: number;
  /** Never-edited transactions applying the rule would change. */
  applicable: number;
}

/** A rule Kuenta proposes after the user categorizes a transaction by hand. */
export interface RuleSuggestion {
  /** The rule text: the bank concept cut at the first `-`, `*` or digit, normalized. */
  text: string;
  /** Other uncategorized, never-edited transactions with the same payee. */
  others: number;
}

export interface RuleChanges {
  name?: string;
  enabled?: boolean;
  match?: Partial<RuleMatch>;
  actions?: RuleActions;
}

/** The only data interface screens use. */
export interface DataRepository {
  /** Called after every write. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;

  getSettings(): Promise<Settings>;
  setPersistRequested(): Promise<void>;
  /** Creates the import account and the starter categories. */
  completeOnboarding(input: { importAccountName: string }): Promise<void>;

  /** Every account in order, archived ones included, with its balance today. */
  listAccounts(): Promise<AccountView[]>;
  /** Creates a non-imported account, placed after every existing one. */
  createAccount(draft: AccountDraft): Promise<AccountSaveResult>;
  /**
   * Changes an account's name, type, icon and colour, and a non-imported account's opening
   * balance. Throws, changing nothing, when given an opening balance for the import account.
   */
  updateAccount(id: Id, changes: AccountChanges): Promise<AccountSaveResult>;
  /** Categories in order; pickers show them in this order. */
  listCategories(): Promise<Category[]>;
  /** Places the category after every existing one of its kind. */
  createCategory(draft: CategoryDraft): Promise<CategorySaveResult>;
  updateCategory(id: Id, changes: CategoryChanges): Promise<CategorySaveResult>;
  /** Swaps the category with the previous or next one of the same kind. */
  moveCategory(id: Id, direction: 'up' | 'down'): Promise<void>;
  /** What deleting the category would affect. */
  categoryUsage(id: Id): Promise<CategoryUsage>;
  /**
   * Deletes a category in one transaction: its transactions move to `moveTo` (null for
   * "Sin categoría") without counting as the user's edits, and the rules that set it lose
   * that action and are disabled, so the user can repoint them.
   */
  deleteCategory(id: Id, moveTo: Id | null): Promise<void>;

  /** Rules in order: the first enabled one that matches a row wins. */
  listRules(): Promise<Rule[]>;
  /**
   * Places the rule before every existing one, so it wins over starter rules. Throws when
   * the rule has no text, or neither a category nor a payee name.
   */
  createRule(draft: RuleDraft): Promise<Id>;
  /**
   * Throws, changing nothing, when the rule would be left without text, or enabled without
   * a category or a payee name (a rule whose category was deleted stays disabled until it gets one).
   */
  updateRule(id: Id, changes: RuleChanges): Promise<void>;
  /** Swaps the rule with the previous or next one, changing which wins. */
  moveRule(id: Id, direction: 'up' | 'down'): Promise<void>;
  /** Deletes the rule only: the categories and payees it already set stay as they are. */
  deleteRule(id: Id): Promise<void>;
  /** Counts for a draft rule (condition with the usual defaults, and its actions), for live feedback while editing. */
  previewRule(draft: Pick<RuleDraft, 'match' | 'actions'>): Promise<RulePreview>;
  /**
   * Applies one rule (`ruleId`, even if disabled) or every enabled rule in order, first
   * match wins, to the imported transactions the user never edited. Returns how many
   * changed. Applying doesn't mark them as edited, so a later rule can still apply.
   */
  applyRules(ruleId?: Id): Promise<number>;
  /**
   * The rule to propose after the user categorized this transaction: its suggested text
   * and how many other uncategorized, never-edited transactions share its payee. Null when
   * there's nothing to suggest: no such transactions, no category, a Bizum or no text left.
   */
  ruleSuggestion(transactionId: Id): Promise<RuleSuggestion | null>;
  /**
   * After an update that brought starter rules to an install with imported transactions:
   * how many never-edited transactions applying the rules would change. Null when there's
   * nothing to offer: a first run, an offer already accepted or dismissed, or nothing to change.
   */
  starterRulesOffer(): Promise<number | null>;
  /** Applies every enabled rule as `applyRules()` does and closes the offer. Returns how many changed. */
  acceptStarterRulesOffer(): Promise<number>;
  /** Closes the offer for good, changing nothing. */
  dismissStarterRulesOffer(): Promise<void>;

  /** Transactions of a month, newest first. */
  listTransactions(month: Month): Promise<TransactionView[]>;
  getTransaction(id: Id): Promise<TransactionView | null>;
  /**
   * Only category, payee, note and whether it's a transfer can change; amount, date and the
   * bank's account come from the bank. Every change counts as the user's edit. Making it a
   * transfer is refused for a balance adjustment, the import account itself, and an
   * archived or unknown account; a transfer never has a category.
   */
  updateTransaction(id: Id, changes: TransactionChanges): Promise<void>;
  /** Balance adjustments can be deleted; imported transactions can't. */
  deleteAdjustment(id: Id): Promise<void>;
  /** Expense categories used on a date, most used first. */
  expenseCategoriesUsedOn(date: IsoDate): Promise<Id[]>;

  /** Every payee, sorted by name, with its number of transactions. */
  listPayees(): Promise<PayeeView[]>;
  /**
   * Renames a payee everywhere it's shown. Refused when another payee already has the
   * name ignoring case and accents: the caller can offer to merge into it instead.
   */
  renamePayee(id: Id, name: string): Promise<PayeeRenameResult>;
  /**
   * Moves every transaction of the merged payees to the kept one and deletes the merged
   * payees, in one transaction. Category, note and the edited marker don't change.
   */
  mergePayees(keepId: Id, mergeIds: Id[]): Promise<void>;

  previewImport(file: Blob | ArrayBuffer, fileName: string): Promise<PreviewResult>;
  /**
   * The preview with the current rules run again on its new rows, e.g. after the user
   * created a rule from one of them. Rows imported before and warnings don't change.
   */
  replanImport(preview: ImportPreview): Promise<ImportPreview>;
  /** Imports the new rows of a preview, except the excluded fingerprints, in one transaction. */
  commitImport(preview: ImportPreview, options?: CommitImportOptions): Promise<ImportOutcome>;
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
