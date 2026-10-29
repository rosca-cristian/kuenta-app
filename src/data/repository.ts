import type { Cents } from '../domain/money';
import type { IsoDate, Month } from '../domain/dates';
import type { Gap } from '../domain/chain';
import type { ImportPlan } from '../domain/importPlan';
import type { MonthlyEntry, MonthSummary } from '../domain/stats';
import type { NetWorthPoint } from '../domain/balances';
import type { BudgetStatus, BudgetTotals } from '../domain/budgets';
import type { GoalProgress } from '../domain/goals';
import type { SavingsProgress } from '../domain/savings';
import type { Subscription, SubscriptionTotals } from '../domain/subscriptions';
import type { BackupCounts, BackupFile, BackupReadResult } from '../domain/backup';
import type { Account, AccountType, Category, CategoryKind, Goal, Id, ImportBatch, Payee, Rule, RuleActions, RuleMatch, Transaction, TxType } from '../domain/model';
import type { ReadError } from '../import/bbva/reader';

export interface AccountView extends Account {
  balance: Cents;
  isImportAccount: boolean;
  /** Transactions from or to the account; it can be deleted only while there are none. */
  transactionCount: number;
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
  /** Its reimbursements, with `amount` as the bank's; null when it has none. */
  reimbursement: ReimbursementView | null;
  /**
   * The month it counts in for income and spending when it isn't its own: a late salary in a
   * category set to count in the next month (`countingMonthOf`). Null for every other transaction.
   */
  countingMonth: Month | null;
}

/** One reimbursement as either of its two transactions sees it. */
export interface ReimbursementLinkView {
  /** The other transaction: the income paying back an expense, or the expense an income pays back. */
  transactionId: Id;
  /** The part, above 0. */
  amount: Cents;
}

/**
 * A transaction's reimbursements. An expense's parts are paid back to it, so it counts as
 * `amount − paidBack` ("Tu parte"); an income's parts are spread over expenses, so only
 * `amount − spread` counts as income. The other field is 0.
 */
export interface ReimbursementView {
  /** For an expense: what incomes paid back of it. */
  paidBack: Cents;
  /** For an income: how much of it pays back expenses. */
  spread: Cents;
  /** Oldest other transaction first. */
  links: ReimbursementLinkView[];
}

/** An expense "Es un reembolso" offers to link to an income. */
export interface ReimbursementCandidate {
  transaction: TransactionView;
  /**
   * What's left of it to pay back: its amount minus what other incomes pay back of it. The
   * income's own part counts as left, since the sheet edits it.
   */
  left: Cents;
  /** The income's current part of it; 0 when not linked yet. */
  part: Cents;
}

/** One part of an income paying back an expense, as "Es un reembolso" saves it. */
export interface ReimbursementPart {
  expenseId: Id;
  /** Whole cents; 0 drops the link. */
  amount: Cents;
}

/**
 * What Movimientos shows of its period: a search, an account, a category or the transactions
 * without one, a type, and the payee Análisis opens it with. Absent fields don't filter; present
 * ones must all hold.
 */
export interface TransactionFilter {
  /**
   * Found, ignoring case and accents, inside the payee's name, the note, the bank concept or the
   * bank movement. Blank doesn't filter.
   */
  text?: string;
  /** The transaction's account or, for a transfer, either of its two accounts. */
  accountId?: Id;
  /** A category's id, or null for "sin categoría": the imported expenses and income without a category. */
  categoryId?: Id | null;
  /** A type, or `'reimbursement'`: the incomes that pay back at least one expense ("Reembolsos"). */
  type?: TxType | 'reimbursement';
  payeeId?: Id;
  /** On or after this date (the transaction's date, inclusive). */
  from?: IsoDate;
  /** On or before this date (the transaction's date, inclusive). */
  to?: IsoDate;
}

export interface Settings {
  onboardingDone: boolean;
  importAccountId: Id | null;
  persistRequested: boolean;
  /** Privacy mode: every amount on screen shows as "•••• €". It belongs to this phone, not to backups. */
  privacyMode: boolean;
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
   * They win over the plan's, a transfer rule's included (the row is then an ordinary
   * expense or income), and those transactions count as edited by the user, so rules
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
  /** Uncategorized imported expenses and income of the month shown: what its "sin categoría" link lists. */
  uncategorized: number;
  gaps: Gap[];
  /** Budgets above 100 % in the current month, whatever month Inicio shows. */
  budgetsOver: number;
  /**
   * Up to 3 of the current month's budgets, whatever month Inicio shows: the highest
   * percentage first, ties by the most spent.
   */
  topBudgets: BudgetView[];
  /** The non-archived goals, in the goals list's order, with their progress. */
  goals: GoalView[];
  /**
   * The month shown against its monthly savings target, as `savings(month)` gives it: its saved
   * amount is `summary.savings`, and the "today" marker shows only in the current month. Null
   * when that month has no target.
   */
  savings: SavingsProgress | null;
  /** Where the month's spending is heading, with its expected charges; null for other months than the current one and before the 3rd. */
  forecast: Cents | null;
  /** Whether to remind the user to make a backup: see `BackupStatus.due`. */
  backupDue: boolean;
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
  /**
   * Income categories: the day from which an imported income in it counts in the next month
   * (1–31; null or absent, never). Ignored for expense categories.
   */
  nextMonthFromDay?: number | null;
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
  /** Whether it has a budget in any month: every limit goes with it. */
  budget: boolean;
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
  /** Imported transactions the rule's condition matches, edited or not, transfers included. */
  matching: number;
  /** Never-edited transactions applying the rule would change, conversions to or from a transfer included. */
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

/** One budgeted category in a month. */
export interface BudgetView {
  category: Category;
  /** The limit in force that month: the category's latest one starting up to it. Above 0. */
  limit: Cents;
  /** Expenses − income in the category that month: negative when more came back than was spent. */
  spent: Cents;
  /** spent / limit × 100, unrounded; 0 when the spending is negative. */
  percent: number;
  /** By the percentage alone: *En camino* below 85 %, *Cerca* up to 100 %, *Superado* above. */
  status: BudgetStatus;
}

/** Presupuestos for one month. */
export interface BudgetsView {
  /** The categories with a limit above 0 that month, in category order. */
  budgets: BudgetView[];
  totals: BudgetTotals;
  /** In the current month, today's share of it (day / days in month), where the "today" marker sits; null otherwise. */
  today: number | null;
}

/** One entry of Análisis → Gastos. */
export interface SpendingEntryView {
  /** Null for "Sin categoría": the month's uncategorized expenses. */
  category: Category | null;
  /** Above 0: expenses − income in the category, as budgets measure it. */
  amount: Cents;
  /** amount / total × 100, unrounded. */
  percent: number;
}

/** Análisis → Gastos for one month: the donut's slices and the list below it. */
export interface SpendingView {
  /** Highest first; categories whose spending is 0 or negative are left out. */
  entries: SpendingEntryView[];
  /** The sum of the entries: the donut's centre. */
  total: Cents;
}

/** Análisis → Patrimonio: net worth at the end of each of the last 12 months. */
export interface NetWorthView {
  /** Oldest first, ending with the current month; months before the first transaction are left out. */
  points: NetWorthPoint[];
  /** The last point's net worth; null when there are no points. */
  latest: Cents | null;
  /** latest − the previous point's net worth; null with fewer than two points. */
  change: Cents | null;
}

/** How many months Análisis → Mensual covers. */
export type MonthlyRange = 6 | 12;

/** Análisis → Mensual: income vs expenses by month. */
export interface MonthlyView {
  /** Oldest first, ending at the current month; empty when there's no data. */
  entries: MonthlyEntry[];
}

/** A goal with its account and how far it is. */
export interface GoalView extends Goal, GoalProgress {
  /** The linked account with its balance today, archived or not: a goal keeps showing an archived account's balance. */
  account: AccountView;
}

export interface GoalDraft {
  name: string;
  /** Above 0. */
  target: Cents;
  /** Any month, past ones included; none (null) by default. */
  targetMonth?: Month | null;
  /** Not archived, and without another non-archived goal. */
  accountId: Id;
  /** A name from the icon set; the account's by default. */
  icon: string;
  /** A palette token; the account's by default. */
  color: string;
}

export type GoalChanges = Partial<GoalDraft>;

/**
 * The outcome of creating, editing or unarchiving a goal. It's refused when the name is
 * empty, or when its account already has another non-archived goal (`existing`): the same
 * money would count twice.
 */
export type GoalSaveResult =
  | { ok: true; id: Id }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'taken'; existing: Goal };

/**
 * Objetivos → Ahorro mensual for a month: its savings against the target in force that month,
 * the "today" marker, the history and the streak; `{ target: null }` when the month has none.
 */
export type SavingsView = SavingsProgress | { target: null };

/** One row of Análisis → Suscripciones. */
export interface SubscriptionView extends Subscription {
  payee: Payee;
}

/** Análisis → Suscripciones: every payee with expenses in "Suscripciones", by name, what they cost and what the category spent this month. */
export interface SubscriptionsView {
  subscriptions: SubscriptionView[];
  totals: SubscriptionTotals;
}

/** Copias de seguridad's last backup line. */
export interface BackupStatus {
  /** When the user last exported or shared a backup on this device (ISO 8601); null when never. */
  lastBackupAt: string | null;
  /**
   * Whether Inicio reminds the user to make a backup: the data changed (`lastChangeAt`) since
   * the last backup, and that one was never made or is more than 7 days old.
   */
  due: boolean;
}

/** The only data interface screens use. */
export interface DataRepository {
  /**
   * Called after every write. Returns an unsubscribe function. Every write that changes the
   * user's data also records when in the `lastChangeAt` setting, before calling it; settings
   * bookkeeping (`persistRequested`, `privacyMode`, `lastBackupAt`, dismissing the starter-rules offer) and
   * onboarding's starter data don't. A write that changes nothing (moving the first category up,
   * saving an edit with what's already there, archiving an archived account…) neither records
   * nor calls it.
   */
  subscribe(listener: () => void): () => void;

  getSettings(): Promise<Settings>;
  setPersistRequested(): Promise<void>;
  /** Turns privacy mode on or off. Settings bookkeeping: it doesn't count as a data change. */
  setPrivacyMode(on: boolean): Promise<void>;
  /** Creates the import account and the starter categories. */
  completeOnboarding(input: { importAccountName: string }): Promise<void>;

  /**
   * Every account in order, archived ones included, with its balance today. Account pickers
   * leave out the archived ones.
   */
  listAccounts(): Promise<AccountView[]>;
  /** Creates a non-imported account, placed after every existing one. */
  createAccount(draft: AccountDraft): Promise<AccountSaveResult>;
  /**
   * Changes an account's name, type, icon and colour, and a non-imported account's opening
   * balance. Throws, changing nothing, when given an opening balance for the import account.
   */
  updateAccount(id: Id, changes: AccountChanges): Promise<AccountSaveResult>;
  /**
   * "Actualizar saldo": makes a non-imported account's balance the typed one with a balance
   * adjustment dated today for the difference, or nothing when it already has it. Returns the
   * adjustment's signed amount (0 when none). Throws, changing nothing, for the import account,
   * whose balance comes from the bank.
   */
  updateAccountBalance(id: Id, balance: Cents): Promise<Cents>;
  /**
   * Archives or unarchives an account. An archived account leaves Inicio's list and the
   * pickers, but its transactions stay and its balance still counts in the total. Throws,
   * changing nothing, for the import account.
   */
  setAccountArchived(id: Id, archived: boolean): Promise<void>;
  /**
   * Deletes an account with no transactions, and its goals, archived ones included. The rules
   * that transfer to it lose that action and are disabled, so the user can repoint them.
   * Throws, changing nothing, while it has any (it can be archived instead) and for the
   * import account.
   */
  deleteAccount(id: Id): Promise<void>;
  /**
   * The non-archived categories in order; pickers show them in this order. With `withArchived`,
   * the archived ones follow, in order: Movimientos' filter still finds their transactions.
   */
  listCategories(options?: { withArchived?: boolean }): Promise<Category[]>;
  /** Places the category after every existing one of its kind. */
  createCategory(draft: CategoryDraft): Promise<CategorySaveResult>;
  updateCategory(id: Id, changes: CategoryChanges): Promise<CategorySaveResult>;
  /** Swaps the category with the previous or next one of the same kind. */
  moveCategory(id: Id, direction: 'up' | 'down'): Promise<void>;
  /** What deleting the category would affect. */
  categoryUsage(id: Id): Promise<CategoryUsage>;
  /**
   * Deletes a category in one transaction: its transactions move to `moveTo` (null for
   * "Sin categoría") without counting as the user's edits, the rules that set it lose
   * that action and are disabled, so the user can repoint them, and its budget limits of
   * every month are deleted.
   */
  deleteCategory(id: Id, moveTo: Id | null): Promise<void>;

  /** Rules in order: the first enabled one that matches a row wins. */
  listRules(): Promise<Rule[]>;
  /**
   * Places the rule before every existing one, so it wins over starter rules. Throws when
   * the rule has no text; no category, transfer account or payee name; both a category and
   * a transfer account; or a transfer account that is unknown or the import account.
   */
  createRule(draft: RuleDraft): Promise<Id>;
  /**
   * Throws, changing nothing, when the rule would be left without text, enabled without a
   * category, a transfer account or a payee name (a rule whose category was deleted stays
   * disabled until it gets one), or with a transfer account `createRule` refuses.
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
   * match wins, to the imported transactions the user never edited, transfers included.
   * Only what differs changes: a transfer rule makes the transaction a transfer with its
   * account, a category rule makes a transfer an expense or income again with its category
   * (both by the bank's sign), and a rule with only a payee name leaves the type alone.
   * Returns how many changed. Applying doesn't mark them as edited, so a later rule can still apply.
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

  /** Transactions of a month, or of all months when `period` is null, newest first; with a filter, only those matching it. */
  listTransactions(period: Month | null, filter?: TransactionFilter): Promise<TransactionView[]>;
  /** The dates of the oldest and the newest transaction, balance adjustments included; null when there are none. */
  transactionDateRange(): Promise<{ first: IsoDate; last: IsoDate } | null>;
  getTransaction(id: Id): Promise<TransactionView | null>;
  /**
   * Only category, payee, note and whether it's a transfer can change; amount, date and the
   * bank's account come from the bank. Every change counts as the user's edit; saving what it
   * already has changes nothing, so it isn't one. Making it a
   * transfer is refused for a balance adjustment, the import account itself, and an
   * archived or unknown account; a transfer never has a category.
   */
  updateTransaction(id: Id, changes: TransactionChanges): Promise<void>;
  /** Balance adjustments can be deleted; imported transactions can't. */
  deleteAdjustment(id: Id): Promise<void>;
  /** Expense categories used on a date, most used first. */
  expenseCategoriesUsedOn(date: IsoDate): Promise<Id[]>;

  /**
   * The expenses an imported income ("Es un reembolso") may pay back: the imported expenses
   * dated from 30 days before it up to its date (with `before`, from 30 days before that date
   * instead: "Ver gastos anteriores"), plus those it already pays back, whatever their date,
   * with something left to pay back. Closest date first, in the bank's order within a day.
   * `text` searches as `TransactionFilter.text` does. Empty for anything but an imported income.
   */
  reimbursementCandidates(incomeId: Id, options?: { text?: string; before?: IsoDate }): Promise<ReimbursementCandidate[]>;
  /**
   * Replaces the expenses an imported income pays back, in one transaction; a part of 0 drops
   * that link and no parts remove them all ("Quitar reembolso"). Throws, changing nothing,
   * unless the income and every expense are imported ones, each part is whole cents and not
   * negative, each expense appears once, the parts add up to the income at most, and what all
   * incomes pay back of an expense is its amount at most. Saving what's already there changes
   * nothing. Balances never change: only income and spending count it.
   */
  setReimbursements(incomeId: Id, parts: ReimbursementPart[]): Promise<void>;

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

  /**
   * Inicio for a month. Its summary counts reimbursements: each expense smaller by what was paid
   * back of it, in its own month, and only what incomes don't pay back as income. Incomes count
   * in their counting month (`countingMonthOf`): a late salary in the next one, and so do the
   * month's savings against its monthly savings target. Balances, goals, the forecast and the
   * uncategorized count take the bank's amounts and dates.
   */
  home(month: Month): Promise<HomeData>;

  /**
   * Análisis → Gastos: each category's spending in the month (by transaction date, incomes by counting month), as
   * `budgets` measures it (expenses − income), leaving out those at 0 or below, plus the
   * uncategorized expenses as "Sin categoría". Transfers and balance adjustments never count.
   * Reimbursements make each expense smaller, and the incomes that pay them back count only
   * for what's left, wherever the other side is dated. Incomes count in their counting month.
   */
  spending(month: Month): Promise<SpendingView>;

  /**
   * Análisis → Patrimonio: the sum of every account's balance, archived and non-imported
   * ones included, on the last day of each of the last 12 months, the current month's
   * being today's. Months before the first transaction are left out. Transfers move money
   * between accounts, so they don't change it; balance adjustments do.
   */
  netWorth(): Promise<NetWorthView>;

  /**
   * Análisis → Mensual: each month's income and expenses, as Inicio's summary counts them,
   * for the last 6 or 12 months ending at the current one, which is marked in progress.
   * The months before the first one with imported transactions are left out. Reimbursements
   * and counting months count as in the summary: a late salary of the current month counts in
   * the next one, which isn't shown until it's the current month, and the series starts at the
   * first month anything counts in.
   */
  monthly(months: MonthlyRange): Promise<MonthlyView>;

  /**
   * The budgets of a month with their spending by transaction date (incomes by counting month). Transfers, balance
   * adjustments and uncategorized transactions never count. Reimbursements and counting months
   * count as in `spending`.
   */
  budgets(month: Month): Promise<BudgetsView>;
  /** The non-archived expense categories without a budget in the month, in order: those "Añadir presupuesto" offers. */
  budgetableCategories(month: Month): Promise<Category[]>;
  /**
   * Sets an expense category's monthly limit from `fromMonth` (the current month by default)
   * on, in one transaction: it replaces the limit starting that month and deletes the
   * category's later ones, so earlier months keep theirs. A 0 limit removes the budget from
   * that month. Throws, changing nothing, for an income or unknown category and for a
   * negative amount or one that isn't whole cents; only removing the budget of a category
   * that has one that month is allowed whatever its kind, for one later made an income one.
   */
  setBudgetLimit(categoryId: Id, amount: Cents, fromMonth?: Month): Promise<void>;

  /**
   * Every goal, archived ones included, in the order of their accounts (then active before
   * archived, then by name), each with its account's balance today as progress and, against
   * the current month, how much to save per month.
   */
  listGoals(): Promise<GoalView[]>;
  /**
   * The accounts the goal editor offers, in order: the non-archived ones without a
   * non-archived goal, plus, when editing (`goalId`), that goal's own account, archived or not.
   */
  goalAccounts(goalId?: Id): Promise<AccountView[]>;
  /**
   * Creates a goal. Refused for an empty name or an account that already has a non-archived
   * goal; throws, changing nothing, for a target that isn't whole cents above 0, a target
   * month that isn't 'YYYY-MM', and an unknown or archived account.
   */
  createGoal(draft: GoalDraft): Promise<GoalSaveResult>;
  /**
   * Changes the given fields of a goal, as `createGoal` checks them. Moving a non-archived
   * goal to an account with another non-archived goal is refused; it can stay on its own
   * account once that's archived, but not move to another archived one. Throws, changing
   * nothing, for an unknown goal.
   */
  updateGoal(id: Id, changes: GoalChanges): Promise<GoalSaveResult>;
  /**
   * Archives a goal, which frees its account for a new one, or unarchives it: refused while
   * its account has another non-archived goal. Throws for an unknown goal.
   */
  setGoalArchived(id: Id, archived: boolean): Promise<GoalSaveResult>;
  /** Deletes a goal and nothing else: a goal has no history. Throws for an unknown goal. */
  deleteGoal(id: Id): Promise<void>;

  /**
   * Objetivos → Ahorro mensual for a month (the current one, in Objetivos). Its savings are
   * always `home(month).summary.savings`: reimbursements netted, incomes in their counting
   * month, transfers and balance adjustments never counting. The history and the streak judge
   * each earlier month against the target it had, and leave out the months before the first one
   * anything counts in, as Análisis → Mensual does.
   */
  savings(month: Month): Promise<SavingsView>;
  /**
   * Sets the monthly savings target from `fromMonth` (the current month by default) on, in one
   * transaction: it replaces the target starting that month and deletes the later ones, so
   * earlier months keep theirs. 0 removes the target from that month. Saving the target already
   * in force, with none after it, changes nothing. Throws, changing nothing, for a negative
   * amount or one that isn't whole cents, and a month that isn't 'YYYY-MM'.
   */
  setSavingsTarget(amount: Cents, fromMonth?: Month): Promise<void>;

  /**
   * Análisis → Suscripciones on today's date: one subscription per payee with an imported
   * expense in the category named "Suscripciones" (ignoring case and accents), its charges
   * being its expenses there, with the monthly and yearly totals. Empty without that category.
   * Charges and the month's spending count reimbursements, and the month's spending counting months, as `spending` does.
   */
  subscriptions(): Promise<SubscriptionsView>;

  /**
   * A backup of every table, read in one transaction so it's consistent, stamped with the
   * clock and the app's version. Only the data settings go in it; the device's are left out,
   * and so, until the next backup format, is the monthly savings target. Making the backup doesn't count as one: the screen calls `markBackupMade` once the file
   * reached the user.
   */
  exportBackup(): Promise<BackupFile>;
  /** Records that a backup was downloaded or shared now. */
  markBackupMade(): Promise<void>;
  backupStatus(): Promise<BackupStatus>;
  /**
   * Reads a backup file's text without writing anything: the backup and its summary (date
   * and counts), or why it can't be restored (not a Kuenta backup, from a newer format, or
   * damaged, naming what's wrong). Older formats are migrated first.
   */
  readBackup(text: string): BackupReadResult;
  /** What the app holds now, counted as a backup's summary counts it. */
  dataCounts(): Promise<BackupCounts>;
  /**
   * Replaces all the data with the backup's in one transaction: every table is cleared and
   * gets the backup's rows; backups don't carry the monthly savings target yet, so none is left.
   * This device's own settings (those that aren't data settings, such as `persistRequested`)
   * stay, onboarding counts as done, and `lastBackupAt` and `lastChangeAt` become the backup's
   * `exportedAt`, since the data now equals a copy the user has. Every screen refreshes.
   */
  restoreBackup(backup: BackupFile): Promise<void>;
}
