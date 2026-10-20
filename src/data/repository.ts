import type { Cents } from '../domain/money';
import type { IsoDate, Month } from '../domain/dates';
import type { Gap } from '../domain/chain';
import type { ImportPlan } from '../domain/importPlan';
import type { MonthSummary } from '../domain/stats';
import type { Account, Category, CategoryKind, Id, ImportBatch, Payee, Rule, RuleActions, RuleMatch, Transaction } from '../domain/model';
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

  listAccounts(): Promise<AccountView[]>;
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
  /** Only category, payee and note can change; amount, date and account come from the bank. */
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
