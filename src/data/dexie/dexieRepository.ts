import { KuentaDb } from "./db";
import {
  STARTER_CATEGORIES,
  STARTER_DATA_VERSION,
  STARTER_RULES,
} from "../seed";
import {
  bankOrder,
  findGaps,
  latestBalanceOf,
  openingBalanceOf,
  type ChainLink,
} from "../../domain/chain";
import { planImport, reapplyRules } from "../../domain/importPlan";
import {
  applyRules as firstMatchActions,
  hasAction,
  ruleMatches,
  suggestedRuleText,
  type RuleSubject,
} from "../../domain/rules";
import {
  isUncategorized,
  monthlySeries,
  monthSpending,
  monthSummary,
} from "../../domain/stats";
import { monthForecast } from "../../domain/forecast";
import { subscriptions, subscriptionTotals } from "../../domain/subscriptions";
import { budgetMonth, limitFor } from "../../domain/budgets";
import { goalProgress } from "../../domain/goals";
import {
  leftToPayBack,
  netOfReimbursements,
} from "../../domain/reimbursements";
import { netWorthSeries } from "../../domain/balances";
import {
  addDays,
  addMonths,
  daysBetween,
  isMonth,
  monthOf,
  today,
  type Month,
} from "../../domain/dates";
import { normalizeText } from "../../domain/text";
import {
  BACKUP_SETTINGS,
  countsOf,
  createBackup,
  isBackupDue,
  readBackup,
  type BackupCounts,
  type BackupFile,
} from "../../domain/backup";
import { shapeByBankSign, transferAccountOf } from "../../domain/transfers";
import {
  signedAmount,
  type Account,
  type Goal,
  type Id,
  type ImportBatch,
  type Reimbursement,
  type Rule,
  type RuleActions,
  type RuleMatch,
  type Transaction,
} from "../../domain/model";
import { readBbvaFile } from "../../import/bbva/reader";
import type {
  AccountChanges,
  AccountDraft,
  AccountSaveResult,
  AccountView,
  BackupStatus,
  BalanceCheck,
  BudgetsView,
  CategoryChanges,
  CategoryDraft,
  CategorySaveResult,
  CategoryUsage,
  CommitImportOptions,
  DataRepository,
  GoalChanges,
  GoalDraft,
  GoalSaveResult,
  GoalView,
  HomeData,
  ImportOutcome,
  ImportPreview,
  MonthlyView,
  NetWorthView,
  PayeeRenameResult,
  PayeeView,
  PreviewResult,
  ReimbursementCandidate,
  ReimbursementView,
  RuleChanges,
  RuleDraft,
  Settings,
  SpendingView,
  SubscriptionsView,
  TransactionChanges,
  TransactionFilter,
  TransactionView,
} from "../repository";

export interface DexieRepositoryOptions {
  /** IndexedDB database name. */
  name?: string;
  /** Clock, injectable for tests. */
  now?: () => Date;
  /** The version backups say made them; the app's own by default. */
  appVersion?: string;
}

type Link = ChainLink & { tx: Transaction };

/** What applying rules changes on one transaction: its type, accounts and category, and its payee. */
type RuleChange = {
  id: Id;
  fields: Partial<
    Pick<Transaction, "type" | "accountId" | "toAccountId" | "categoryId">
  >;
  payeeName?: string;
};

/**
 * Whether writing `update` would change the row: some field it gives differs (objects compared
 * by their JSON). A write that changes nothing isn't a change to the user's data.
 */
const differs = <T extends object>(row: T, update: Partial<T>) =>
  (Object.keys(update) as (keyof T)[]).some(
    (key) => JSON.stringify(update[key]) !== JSON.stringify(row[key]),
  );

/** A payee name as stored: single spaces, no leading or trailing ones. */
const tidyName = (name: string) => name.replace(/\s+/g, " ").trim();

/** A rule's actions as stored: a blank payee name is no action. */
function tidyActions(actions: RuleActions): RuleActions {
  const tidy: RuleActions = {};
  if (actions.categoryId !== undefined) tidy.categoryId = actions.categoryId;
  if (actions.transferAccountId !== undefined)
    tidy.transferAccountId = actions.transferAccountId;
  const payeeName = tidyName(actions.payeeName ?? "");
  if (payeeName !== "") tidy.payeeName = payeeName;
  return tidy;
}

/**
 * Setting for Inicio's offer to apply the starter rules to the transactions imported
 * before an update brought them: 'pending' until accepted or dismissed, then 'done'.
 * Absent when no update brought them (e.g. a first run).
 */
const STARTER_RULES_OFFER = "starterRulesOffer";
type StarterRulesOffer = "pending" | "done";

/** How far back, in days, "Es un reembolso" looks for the expenses an income pays back, and each "Ver gastos anteriores" more. */
const REIMBURSEMENT_WINDOW_DAYS = 30;

const isDefined = <T>(item: T | undefined): item is T => item !== undefined;

/** Whether `text` (normalized; blank matches all) is in the payee's name, the note, the bank concept or the bank movement. */
const matchesText = (tx: TransactionView, text: string) =>
  text === "" ||
  [tx.payee?.name, tx.note, tx.bankConcept, tx.bankMovement].some(
    (field) => field && normalizeText(field).includes(text),
  );

/** How many budgets Inicio shows. */
const TOP_BUDGETS = 3;

export function createDexieRepository(
  options: DexieRepositoryOptions = {},
): DataRepository {
  const db = new KuentaDb(options.name);
  const now = options.now ?? (() => new Date());
  const appVersion = options.appVersion ?? __APP_VERSION__;
  const listeners = new Set<() => void>();
  /** Tells the screens something was written. Alone, for settings bookkeeping that doesn't change the user's data. */
  const changed = () => listeners.forEach((listener) => listener());
  const stamp = () => now().toISOString();
  /**
   * After a write that changed the user's data: records it in `lastChangeAt`, which Inicio's
   * backup reminder looks at, then tells the screens.
   */
  async function dataChanged() {
    await db.settings.put({ key: "lastChangeAt", value: stamp() });
    changed();
  }

  async function setting<T>(key: string, fallback: T): Promise<T> {
    const row = await db.settings.get(key);
    return row === undefined ? fallback : (row.value as T);
  }

  const setStarterRulesOffer = (state: StarterRulesOffer) =>
    db.settings.put({ key: STARTER_RULES_OFFER, value: state });

  async function importAccountId(): Promise<Id> {
    const id = await setting<Id | null>("importAccountId", null);
    if (!id) throw new Error("No import account configured");
    return id;
  }

  /** The import account's imported transactions as links of the bank chain, in bank order. */
  async function chainOf(accountId: Id): Promise<Link[]> {
    const txs = await db.transactions
      .filter((tx) => tx.source === "import")
      .toArray();
    const links = txs
      .filter(
        (tx) => tx.accountId === accountId || tx.toAccountId === accountId,
      )
      .map((tx) => ({
        bookingDate: tx.bookingDate!,
        amount: signedAmount(tx, accountId),
        balance: tx.bankBalance!,
        tx,
      }));
    return bankOrder(links);
  }

  async function balanceOf(
    account: Account,
    txs: Transaction[],
  ): Promise<number> {
    return txs.reduce(
      (sum, tx) => sum + signedAmount(tx, account.id),
      account.openingBalance,
    );
  }

  async function accountTransactions(accountId: Id): Promise<Transaction[]> {
    const [from, to] = await Promise.all([
      db.transactions
        .where("[accountId+date]")
        .between([accountId, ""], [accountId, "￿"])
        .toArray(),
      db.transactions
        .where("[toAccountId+date]")
        .between([accountId, ""], [accountId, "￿"])
        .toArray(),
    ]);
    return [...from, ...to];
  }

  /** Recomputes the import account's opening balance from the oldest imported row. */
  async function refreshOpeningBalance(accountId: Id) {
    const opening = openingBalanceOf(await chainOf(accountId)) ?? 0;
    await db.accounts.update(accountId, {
      openingBalance: opening,
      updatedAt: stamp(),
    });
  }

  async function computeBalanceCheck(): Promise<BalanceCheck | null> {
    const accountId = await importAccountId();
    const bankBalance = latestBalanceOf(await chainOf(accountId));
    if (bankBalance === null) return null;
    const account = (await db.accounts.get(accountId))!;
    const appBalance = await balanceOf(
      account,
      await accountTransactions(accountId),
    );
    return { bankBalance, appBalance, difference: bankBalance - appBalance };
  }

  /**
   * What an imported transaction changes to with this transfer account, or with none
   * (null): type and accounts by the bank's sign, and no category. Nothing when it already
   * is that. Throws for a balance adjustment, the import account, or an archived or unknown account.
   */
  async function transferChange(
    tx: Transaction,
    transferAccountId: Id | null,
  ): Promise<Partial<Transaction>> {
    const importId = await importAccountId();
    if (transferAccountId === transferAccountOf(tx, importId)) return {};
    if (tx.source !== "import")
      throw new Error("Only imported transactions can be transfers");
    if (transferAccountId !== null) {
      const account = await db.accounts.get(transferAccountId);
      if (!account) throw new Error(`Account ${transferAccountId} not found`);
      if (account.archived)
        throw new Error(
          `Can't transfer to the archived account ${account.name}`,
        );
    }
    return {
      ...shapeByBankSign(
        signedAmount(tx, importId),
        importId,
        transferAccountId,
      ),
      categoryId: null,
    };
  }

  /**
   * Throws unless the rule can be saved: it needs a text; an action unless it's disabled
   * (deleting a category can leave a disabled rule without one, to be repointed); and a
   * category or a transfer account, never both. Its transfer account must exist and not be
   * the import account; an archived one is fine, so archiving never changes what rules do.
   * Call it inside a transaction on accounts and settings.
   */
  async function checkRule(rule: Rule) {
    if (normalizeText(rule.match.value) === "")
      throw new Error("A rule needs a text to match");
    if (rule.enabled && !hasAction(rule.actions))
      throw new Error(
        "An enabled rule needs a category, a transfer account or a payee name",
      );
    const { categoryId, transferAccountId } = rule.actions;
    if (transferAccountId === undefined) return;
    if (categoryId !== undefined)
      throw new Error(
        "A rule sets a category or a transfer account, never both",
      );
    if (!(await db.accounts.get(transferAccountId)))
      throw new Error(`Account ${transferAccountId} not found`);
    if (transferAccountId === (await importAccountId()))
      throw new Error("A rule can't transfer to the import account");
  }

  async function payeeIdFor(name: string | null): Promise<Id | null> {
    const trimmed = tidyName(name ?? "");
    if (trimmed === "") return null;
    const normalized = normalizeText(trimmed);
    const existing = await db.payees
      .where("normalized")
      .equals(normalized)
      .first();
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    await db.payees.add({ id, name: trimmed, normalized });
    return id;
  }

  /**
   * Adds the starter categories missing by normalized name, and the starter rules
   * newer than `fromVersion` that the install doesn't already have. Returns how many
   * rules it added. Call it inside a transaction on categories, rules and settings.
   */
  async function addStarterData(fromVersion: number): Promise<number> {
    const categories = await db.categories.toArray();
    const categoryIds = new Map(
      categories.map((category) => [normalizeText(category.name), category.id]),
    );
    let categoryOrder = Math.max(
      -1,
      ...categories.map((category) => category.order),
    );
    for (const starter of STARTER_CATEGORIES) {
      if (categoryIds.has(normalizeText(starter.name))) continue;
      const id = crypto.randomUUID();
      await db.categories.add({
        ...starter,
        id,
        order: ++categoryOrder,
        archived: false,
      });
      categoryIds.set(normalizeText(starter.name), id);
    }

    const matchKey = (match: RuleMatch) =>
      [match.field, match.op, normalizeText(match.value), match.direction].join(
        "|",
      );
    const rules = await db.rules.toArray();
    const existingMatches = new Set(rules.map((rule) => matchKey(rule.match)));
    let ruleOrder = Math.max(-1, ...rules.map((rule) => rule.order));
    let added = 0;
    for (const starter of STARTER_RULES.filter(
      (rule) => rule.since > fromVersion,
    )) {
      if (existingMatches.has(matchKey(starter.match))) continue;
      added++;
      const actions: RuleActions = {
        categoryId: categoryIds.get(normalizeText(starter.category))!,
      };
      if (starter.payeeName) actions.payeeName = starter.payeeName;
      await db.rules.add({
        id: crypto.randomUUID(),
        name: starter.name,
        order: ++ruleOrder,
        enabled: true,
        match: { ...starter.match },
        actions,
      });
    }
    await db.settings.put({
      key: "starterDataVersion",
      value: STARTER_DATA_VERSION,
    });
    return added;
  }

  /**
   * What rules look at in an imported transaction. The amount is the bank's, as seen from
   * the import account, so a transfer coming back from Revolut is still a credit.
   */
  const subjectOf = (tx: Transaction, importId: Id): RuleSubject => ({
    concept: tx.bankConcept ?? "",
    movement: tx.bankMovement ?? "",
    amount: signedAmount(tx, importId),
  });

  /**
   * What the rules (first enabled match wins, by order) would change on the imported
   * transactions the user never edited, transfers included: only what differs from what
   * they have. A transfer rule makes the transaction a transfer with its account; a
   * category rule makes a transfer an expense or income again, both by the bank's sign; a
   * rule with only a payee name leaves the type alone. Call it inside a transaction on
   * settings, transactions and payees.
   */
  async function ruleChanges(rules: Rule[]): Promise<RuleChange[]> {
    const importId = await setting<Id | null>("importAccountId", null);
    if (importId === null) return [];
    const [txs, payees] = await Promise.all([
      db.transactions
        .filter((tx) => tx.source === "import" && tx.editedAt === null)
        .toArray(),
      db.payees.toArray(),
    ]);
    const payeeNames = new Map(
      payees.map((payee) => [payee.id, payee.normalized]),
    );
    const changes: RuleChange[] = [];
    for (const tx of txs) {
      const subject = subjectOf(tx, importId);
      const actions = firstMatchActions(rules, subject);
      if (!actions) continue;
      const change: RuleChange = { id: tx.id, fields: {} };
      const transferAccountId = transferAccountOf(tx, importId);
      if (actions.transferAccountId !== undefined) {
        if (actions.transferAccountId !== transferAccountId) {
          change.fields = {
            ...shapeByBankSign(
              subject.amount,
              importId,
              actions.transferAccountId,
            ),
            categoryId: null,
          };
        }
      } else if (actions.categoryId !== undefined) {
        if (transferAccountId !== null) {
          change.fields = {
            ...shapeByBankSign(subject.amount, importId, null),
            categoryId: actions.categoryId,
          };
        } else if (actions.categoryId !== tx.categoryId) {
          change.fields = { categoryId: actions.categoryId };
        }
      }
      const payeeName = tidyName(actions.payeeName ?? "");
      if (
        payeeName !== "" &&
        normalizeText(payeeName) !== (tx.payeeId && payeeNames.get(tx.payeeId))
      )
        change.payeeName = payeeName;
      if (
        Object.keys(change.fields).length > 0 ||
        change.payeeName !== undefined
      )
        changes.push(change);
    }
    return changes;
  }

  /**
   * Applies the rules to the transactions the user never edited, leaving them never
   * edited. Returns how many changed. Call it inside a transaction on settings, rules, transactions and payees.
   */
  async function applyToNeverEdited(rules: Rule[]): Promise<number> {
    const changes = await ruleChanges(rules);
    for (const change of changes) {
      const update: Partial<Transaction> = {
        ...change.fields,
        updatedAt: stamp(),
      };
      if (change.payeeName !== undefined)
        update.payeeId = await payeeIdFor(change.payeeName);
      await db.transactions.update(change.id, update);
    }
    await dropReimbursementsOf(
      changes
        .filter((change) => change.fields.type === "transfer")
        .map((change) => change.id),
    );
    return changes.length;
  }

  /**
   * Deletes the reimbursements of these transactions, as income or as expense. A transaction
   * made a transfer loses them for good: undoing the transfer doesn't bring them back.
   * Call it inside a transaction on reimbursements.
   */
  async function dropReimbursementsOf(ids: Id[]) {
    if (ids.length === 0) return;
    await db.reimbursements.where("incomeId").anyOf(ids).delete();
    await db.reimbursements.where("expenseId").anyOf(ids).delete();
  }

  // On startup, an install made by an older version gets the starter data added since.
  // The first run seeds the current version itself (completeOnboarding). If it fails,
  // nothing is written, the app still opens and the next startup tries again.
  // When the new starter rules would change transactions already imported, Inicio
  // offers to apply them (STARTER_RULES_OFFER).
  db.on("ready", () =>
    db
      .transaction(
        "rw",
        [db.categories, db.rules, db.settings, db.transactions, db.payees],
        async () => {
          if (!(await setting("onboardingDone", false))) return;
          const version = await setting("starterDataVersion", 1);
          if (version >= STARTER_DATA_VERSION) return;
          const addedRules = await addStarterData(version);
          if (
            addedRules > 0 &&
            (await ruleChanges(await db.rules.toArray())).length > 0
          ) {
            await setStarterRulesOffer("pending");
          }
        },
      )
      .catch((error: unknown) =>
        console.error("Could not add the starter data", error),
      ),
  );

  /** Points rules that set one of these payees (by normalized name) to the payee's new name. */
  async function renameInRules(normalizedNames: string[], name: string) {
    const targets = new Set(normalizedNames);
    await db.rules
      .filter(
        (rule) =>
          rule.actions.payeeName !== undefined &&
          targets.has(normalizeText(rule.actions.payeeName)),
      )
      .modify((rule) => {
        rule.actions = { ...rule.actions, payeeName: name };
      });
  }

  /** Why a category can't take this name: it's empty, or another category has it ignoring case and accents. */
  async function refuseCategoryName(
    name: string,
    ownId: Id,
  ): Promise<CategorySaveResult | null> {
    if (name === "") return { ok: false, reason: "empty" };
    const normalized = normalizeText(name);
    const existing = await db.categories
      .filter(
        (category) =>
          category.id !== ownId && normalizeText(category.name) === normalized,
      )
      .first();
    return existing ? { ok: false, reason: "exists", existing } : null;
  }

  /** Why an account can't take this name: it's empty, or another account has it ignoring case and accents. */
  async function refuseAccountName(
    name: string,
    ownId: Id,
  ): Promise<AccountSaveResult | null> {
    if (name === "") return { ok: false, reason: "empty" };
    const normalized = normalizeText(name);
    const existing = await db.accounts
      .filter(
        (account) =>
          account.id !== ownId && normalizeText(account.name) === normalized,
      )
      .first();
    return existing ? { ok: false, reason: "exists", existing } : null;
  }

  function checkWholeCents(cents: number, what: string) {
    if (!Number.isSafeInteger(cents))
      throw new Error(`${what} must be whole cents, not ${cents}`);
  }

  function checkMonth(month: Month) {
    if (!isMonth(month)) throw new Error(`Not a month: ${month}`);
  }

  function checkGoalTarget(target: number) {
    checkWholeCents(target, "A goal target");
    if (target <= 0)
      throw new Error(`A goal target must be above 0, not ${target}`);
  }

  /** A goal can go on any account but an archived one, except the one it's already on. */
  async function checkGoalAccount(accountId: Id, ownAccountId: Id | null) {
    const account = await db.accounts.get(accountId);
    if (!account) throw new Error(`Account ${accountId} not found`);
    if (account.archived && accountId !== ownAccountId)
      throw new Error(
        `Account ${account.name} is archived: it can't get a goal`,
      );
  }

  /** Why a goal can't be on this account: another non-archived goal (`existing`) already is, so its money would count twice. */
  async function refuseGoalAccount(
    accountId: Id,
    ownId: Id,
  ): Promise<GoalSaveResult | null> {
    const existing = await db.goals
      .where("accountId")
      .equals(accountId)
      .filter((goal) => goal.id !== ownId && !goal.archived)
      .first();
    return existing ? { ok: false, reason: "taken", existing } : null;
  }

  /** The account, unless it's missing or the import account (which `action` doesn't apply to). */
  async function nonImportedAccount(id: Id, action: string): Promise<Account> {
    const account = await db.accounts.get(id);
    if (!account) throw new Error(`Account ${id} not found`);
    if (id === (await importAccountId()))
      throw new Error(`The import account can't ${action}`);
    return account;
  }

  /** An uncategorized balance adjustment of `difference` (signed, not 0) on the account, dated today. */
  async function addBalanceAdjustment(accountId: Id, difference: number) {
    const createdAt = stamp();
    await db.transactions.add({
      id: crypto.randomUUID(),
      type: difference > 0 ? "income" : "expense",
      amount: Math.abs(difference),
      date: today(now()),
      accountId,
      toAccountId: null,
      categoryId: null,
      payeeId: null,
      note: "Ajuste de saldo",
      source: "adjustment",
      importBatchId: null,
      importHash: null,
      bookingDate: null,
      bankConcept: null,
      bankMovement: null,
      bankBalance: null,
      editedAt: null,
      createdAt,
      updatedAt: createdAt,
    });
  }

  /**
   * The live reimbursements of these transactions, as income or as expense, with every
   * transaction they link. A link whose income or expense is gone, or isn't an imported one
   * any more (e.g. made a transfer), is left out: it counts nowhere.
   */
  async function linksOf(
    ids: Id[],
  ): Promise<{ links: Reimbursement[]; linked: Map<Id, Transaction> }> {
    if (ids.length === 0) return { links: [], linked: new Map() };
    const [asIncome, asExpense] = await Promise.all([
      db.reimbursements.where("incomeId").anyOf(ids).toArray(),
      db.reimbursements.where("expenseId").anyOf(ids).toArray(),
    ]);
    const all = [
      ...new Map(
        [...asIncome, ...asExpense].map((link) => [link.id, link]),
      ).values(),
    ];
    const txs = await db.transactions.bulkGet([
      ...new Set(all.flatMap((link) => [link.incomeId, link.expenseId])),
    ]);
    const linked = new Map(txs.filter(isDefined).map((tx) => [tx.id, tx]));
    const is = (id: Id, type: Transaction["type"]) =>
      linked.get(id)?.source === "import" && linked.get(id)?.type === type;
    return {
      links: all.filter(
        (link) => is(link.incomeId, "income") && is(link.expenseId, "expense"),
      ),
      linked,
    };
  }

  /**
   * The transactions as income and spending count them, each expense smaller by what was paid
   * back of it and each income by what it pays back (`netOfReimbursements`), whether or not the
   * other side is among them.
   */
  async function netted(txs: Transaction[]): Promise<Transaction[]> {
    return netOfReimbursements(
      txs,
      (await linksOf(txs.map((tx) => tx.id))).links,
    );
  }

  /** A transaction's reimbursements as its view shows them, oldest other transaction first; null without any. */
  function reimbursementOf(
    tx: Transaction,
    links: Reimbursement[],
    linked: Map<Id, Transaction>,
  ): ReimbursementView | null {
    const asExpense = tx.type === "expense";
    const own = links.filter(
      (link) => (asExpense ? link.expenseId : link.incomeId) === tx.id,
    );
    if (own.length === 0) return null;
    const other = (link: Reimbursement) =>
      linked.get(asExpense ? link.incomeId : link.expenseId)!;
    const total = own.reduce((sum, link) => sum + link.amount, 0);
    return {
      paidBack: asExpense ? total : 0,
      spread: asExpense ? 0 : total,
      links: own
        .sort(
          (a, b) =>
            other(a).date.localeCompare(other(b).date) ||
            other(a).id.localeCompare(other(b).id),
        )
        .map((link) => ({
          transactionId: other(link).id,
          amount: link.amount,
        })),
    };
  }

  async function toViews(txs: Transaction[]): Promise<TransactionView[]> {
    const [accounts, categories, payees, { links, linked }] = await Promise.all(
      [
        db.accounts.toArray(),
        db.categories.toArray(),
        db.payees.bulkGet([
          ...new Set(
            txs.map((tx) => tx.payeeId).filter((id): id is Id => id !== null),
          ),
        ]),
        linksOf(txs.map((tx) => tx.id)),
      ],
    );
    const byId = <T extends { id: Id }>(items: (T | undefined)[]) =>
      new Map(
        items
          .filter((item): item is T => item !== undefined)
          .map((item) => [item.id, item]),
      );
    const accountMap = byId(accounts);
    const categoryMap = byId(categories);
    const payeeMap = byId(payees);
    return txs.map((tx) => ({
      ...tx,
      account: accountMap.get(tx.accountId)!,
      toAccount: tx.toAccountId
        ? (accountMap.get(tx.toAccountId) ?? null)
        : null,
      category: tx.categoryId ? (categoryMap.get(tx.categoryId) ?? null) : null,
      payee: tx.payeeId ? (payeeMap.get(tx.payeeId) ?? null) : null,
      reimbursement: reimbursementOf(tx, links, linked),
    }));
  }

  /** A month's transactions, by their date. */
  const transactionsIn = (month: Month) =>
    db.transactions
      .where("date")
      .between(`${month}-01`, `${addMonths(month, 1)}-01`)
      .toArray();

  /** A category's budget limits, of every month. */
  const limitsOf = (categoryId: Id) =>
    db.budgetLimits
      .where("[categoryId+fromMonth]")
      .between([categoryId, ""], [categoryId, "￿"]);

  /**
   * Newest first: by date and, within a date, imported transactions in reverse bank order. The
   * bank order comes from the import account's whole chain, so it holds for a filtered list too.
   */
  async function newestFirst(txs: Transaction[]): Promise<Transaction[]> {
    const accountId = await setting<Id | null>("importAccountId", null);
    const bankIndex = new Map(
      (accountId ? await chainOf(accountId) : []).map((link, index) => [
        link.tx.id,
        index,
      ]),
    );
    const position = (tx: Transaction) => bankIndex.get(tx.id) ?? -1;
    return txs.sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.bookingDate ?? "").localeCompare(a.bookingDate ?? "") ||
        position(b) - position(a) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  }

  const repository: DataRepository = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async getSettings(): Promise<Settings> {
      return {
        onboardingDone: await setting("onboardingDone", false),
        importAccountId: await setting<Id | null>("importAccountId", null),
        persistRequested: await setting("persistRequested", false),
        privacyMode: await setting("privacyMode", false),
      };
    },

    async setPersistRequested() {
      await db.settings.put({ key: "persistRequested", value: true });
      changed();
    },

    async setPrivacyMode(on) {
      await db.settings.put({ key: "privacyMode", value: on });
      changed();
    },

    async completeOnboarding({ importAccountName }) {
      const createdAt = stamp();
      const accountId = crypto.randomUUID();
      await db.transaction(
        "rw",
        [db.accounts, db.categories, db.rules, db.settings],
        async () => {
          await db.accounts.add({
            id: accountId,
            name: importAccountName.trim() || "BBVA",
            type: "bank",
            openingBalance: 0,
            color: "blue",
            icon: "landmark",
            archived: false,
            order: 0,
            createdAt,
            updatedAt: createdAt,
          });
          await addStarterData(0);
          await db.settings.bulkPut([
            { key: "importAccountId", value: accountId },
            { key: "onboardingDone", value: true },
          ]);
        },
      );
      // Only the starter data so far: nothing a backup would save yet.
      changed();
    },

    async listAccounts(): Promise<AccountView[]> {
      const importId = await setting<Id | null>("importAccountId", null);
      const accounts = await db.accounts.orderBy("order").toArray();
      return Promise.all(
        accounts.map(async (account) => {
          const txs = await accountTransactions(account.id);
          return {
            ...account,
            balance: await balanceOf(account, txs),
            isImportAccount: account.id === importId,
            transactionCount: txs.length,
          };
        }),
      );
    },

    async createAccount(draft: AccountDraft): Promise<AccountSaveResult> {
      const id = crypto.randomUUID();
      const name = tidyName(draft.name);
      const openingBalance = draft.openingBalance ?? 0;
      checkWholeCents(openingBalance, "An opening balance");
      const result = await db.transaction(
        "rw",
        db.accounts,
        async (): Promise<AccountSaveResult> => {
          const refused = await refuseAccountName(name, id);
          if (refused) return refused;
          const last = await db.accounts.orderBy("order").last();
          const createdAt = stamp();
          await db.accounts.add({
            id,
            name,
            type: draft.type,
            icon: draft.icon,
            color: draft.color,
            openingBalance,
            archived: false,
            order: last ? last.order + 1 : 0,
            createdAt,
            updatedAt: createdAt,
          });
          return { ok: true, id };
        },
      );
      if (result.ok) await dataChanged();
      return result;
    },

    async updateAccount(
      id,
      changes: AccountChanges,
    ): Promise<AccountSaveResult> {
      const update =
        changes.name === undefined
          ? { ...changes }
          : { ...changes, name: tidyName(changes.name) };
      if (update.openingBalance !== undefined) {
        checkWholeCents(update.openingBalance, "An opening balance");
        // The import account's opening balance follows its imports (see refreshOpeningBalance).
        if (id === (await importAccountId()))
          throw new Error(
            "The import account's opening balance comes from its imports",
          );
      }
      let edited = false;
      const result = await db.transaction(
        "rw",
        db.accounts,
        async (): Promise<AccountSaveResult> => {
          const account = await db.accounts.get(id);
          if (!account) throw new Error(`Account ${id} not found`);
          const refused =
            update.name === undefined
              ? null
              : await refuseAccountName(update.name, id);
          if (refused) return refused;
          edited = differs(account, update);
          if (edited)
            await db.accounts.update(id, { ...update, updatedAt: stamp() });
          return { ok: true, id };
        },
      );
      if (edited) await dataChanged();
      return result;
    },

    async updateAccountBalance(id, balance) {
      checkWholeCents(balance, "A balance");
      const difference = await db.transaction(
        "rw",
        db.accounts,
        db.transactions,
        db.settings,
        async () => {
          const account = await nonImportedAccount(
            id,
            "have its balance typed",
          );
          const difference =
            balance - (await balanceOf(account, await accountTransactions(id)));
          if (difference !== 0) await addBalanceAdjustment(id, difference);
          return difference;
        },
      );
      if (difference !== 0) await dataChanged();
      return difference;
    },

    async setAccountArchived(id, archived) {
      const edited = await db.transaction(
        "rw",
        db.accounts,
        db.settings,
        async () => {
          const account = await nonImportedAccount(id, "be archived");
          if (account.archived === archived) return false;
          await db.accounts.update(id, { archived, updatedAt: stamp() });
          return true;
        },
      );
      if (edited) await dataChanged();
    },

    async deleteAccount(id) {
      await db.transaction(
        "rw",
        [db.accounts, db.transactions, db.settings, db.rules, db.goals],
        async () => {
          await nonImportedAccount(id, "be deleted");
          const count = (await accountTransactions(id)).length;
          if (count > 0)
            throw new Error(
              `Account ${id} has ${count} transactions: archive it instead`,
            );
          // Disabled rather than deleted, so the user can repoint them; any payee action stays.
          await db.rules
            .filter((rule) => rule.actions.transferAccountId === id)
            .modify((rule) => {
              delete rule.actions.transferAccountId;
              rule.enabled = false;
            });
          await db.goals.where("accountId").equals(id).delete();
          await db.accounts.delete(id);
        },
      );
      await dataChanged();
    },

    async listCategories({ withArchived = false } = {}) {
      const categories = await db.categories.orderBy("order").toArray();
      const active = categories.filter((category) => !category.archived);
      return withArchived
        ? [...active, ...categories.filter((category) => category.archived)]
        : active;
    },

    async createCategory(draft: CategoryDraft): Promise<CategorySaveResult> {
      const id = crypto.randomUUID();
      const name = tidyName(draft.name);
      const result = await db.transaction(
        "rw",
        db.categories,
        async (): Promise<CategorySaveResult> => {
          const refused = await refuseCategoryName(name, id);
          if (refused) return refused;
          const last = await db.categories.orderBy("order").last();
          await db.categories.add({
            ...draft,
            name,
            id,
            order: last ? last.order + 1 : 0,
            archived: false,
          });
          return { ok: true, id };
        },
      );
      if (result.ok) await dataChanged();
      return result;
    },

    async updateCategory(
      id,
      changes: CategoryChanges,
    ): Promise<CategorySaveResult> {
      const update =
        changes.name === undefined
          ? { ...changes }
          : { ...changes, name: tidyName(changes.name) };
      let edited = false;
      const result = await db.transaction(
        "rw",
        db.categories,
        async (): Promise<CategorySaveResult> => {
          const category = await db.categories.get(id);
          if (!category) throw new Error(`Category ${id} not found`);
          const refused =
            update.name === undefined
              ? null
              : await refuseCategoryName(update.name, id);
          if (refused) return refused;
          edited = differs(category, update);
          if (edited) await db.categories.update(id, update);
          return { ok: true, id };
        },
      );
      if (edited) await dataChanged();
      return result;
    },

    async moveCategory(id, direction) {
      const moved = await db.transaction("rw", db.categories, async () => {
        const category = await db.categories.get(id);
        if (!category) throw new Error(`Category ${id} not found`);
        const sameKind = await db.categories
          .orderBy("order")
          .filter((other) => other.kind === category.kind && !other.archived)
          .toArray();
        const neighbour =
          sameKind[
            sameKind.findIndex((other) => other.id === id) +
              (direction === "up" ? -1 : 1)
          ];
        // The first one can't go up, nor the last one down.
        if (!neighbour) return false;
        await db.categories.update(id, { order: neighbour.order });
        await db.categories.update(neighbour.id, { order: category.order });
        return true;
      });
      if (moved) await dataChanged();
    },

    async categoryUsage(id): Promise<CategoryUsage> {
      const [transactions, rules, budgets] = await Promise.all([
        db.transactions.where("categoryId").equals(id).count(),
        db.rules.filter((rule) => rule.actions.categoryId === id).count(),
        limitsOf(id)
          .filter((limit) => limit.amount > 0)
          .count(),
      ]);
      return { transactions, rules, budget: budgets > 0 };
    },

    async deleteCategory(id, moveTo) {
      await db.transaction(
        "rw",
        [db.categories, db.transactions, db.rules, db.budgetLimits],
        async () => {
          if (!(await db.categories.get(id)))
            throw new Error(`Category ${id} not found`);
          if (
            moveTo === id ||
            (moveTo !== null && !(await db.categories.get(moveTo)))
          ) {
            throw new Error(
              `Can't move the transactions of category ${id} to ${moveTo}`,
            );
          }
          // Only the category changes: the user's edited marker and every amount stay as they were.
          await db.transactions
            .where("categoryId")
            .equals(id)
            .modify({ categoryId: moveTo, updatedAt: stamp() });
          // Disabled rather than deleted, so the user can repoint them; any payee action stays.
          await db.rules
            .filter((rule) => rule.actions.categoryId === id)
            .modify((rule) => {
              delete rule.actions.categoryId;
              rule.enabled = false;
            });
          // No orphan budget remains, in any month.
          await limitsOf(id).delete();
          await db.categories.delete(id);
        },
      );
      await dataChanged();
    },

    async listRules() {
      return db.rules.orderBy("order").toArray();
    },

    async createRule(draft: RuleDraft) {
      const id = crypto.randomUUID();
      await db.transaction(
        "rw",
        db.rules,
        db.accounts,
        db.settings,
        async () => {
          // A user's rule goes before every other, starter rules included, so it wins.
          const first = await db.rules.orderBy("order").first();
          const rule: Rule = {
            id,
            name: draft.name,
            order: first ? first.order - 1 : 0,
            enabled: draft.enabled ?? true,
            match: {
              field: "conceptOrMovement",
              op: "contains",
              direction: "any",
              ...draft.match,
            },
            actions: tidyActions(draft.actions),
          };
          // A new rule needs an action even when it starts disabled.
          await checkRule({ ...rule, enabled: true });
          await db.rules.add(rule);
        },
      );
      await dataChanged();
      return id;
    },

    async updateRule(id, changes: RuleChanges) {
      const edited = await db.transaction(
        "rw",
        db.rules,
        db.accounts,
        db.settings,
        async () => {
          const rule = await db.rules.get(id);
          if (!rule) throw new Error(`Rule ${id} not found`);
          const updated: Rule = {
            ...rule,
            ...changes,
            match: { ...rule.match, ...changes.match },
            actions: tidyActions(changes.actions ?? rule.actions),
          };
          await checkRule(updated);
          if (!differs(rule, updated)) return false;
          await db.rules.put(updated);
          return true;
        },
      );
      if (edited) await dataChanged();
    },

    async moveRule(id, direction) {
      const moved = await db.transaction("rw", db.rules, async () => {
        const rules = await db.rules.orderBy("order").toArray();
        const index = rules.findIndex((rule) => rule.id === id);
        if (index < 0) throw new Error(`Rule ${id} not found`);
        const neighbour = rules[index + (direction === "up" ? -1 : 1)];
        // The first one can't go up, nor the last one down.
        if (!neighbour) return false;
        await db.rules.update(id, { order: neighbour.order });
        await db.rules.update(neighbour.id, { order: rules[index].order });
        return true;
      });
      if (moved) await dataChanged();
    },

    async deleteRule(id) {
      // Transactions don't remember which rule set them, so nothing else changes.
      await db.rules.delete(id);
      await dataChanged();
    },

    async previewRule(draft) {
      const rule: Rule = {
        id: "draft",
        name: "",
        order: 0,
        enabled: true,
        match: {
          field: "conceptOrMovement",
          op: "contains",
          direction: "any",
          ...draft.match,
        },
        actions: draft.actions,
      };
      return db.transaction(
        "r",
        db.settings,
        db.transactions,
        db.payees,
        async () => {
          const importId = await setting<Id | null>("importAccountId", null);
          if (importId === null) return { matching: 0, applicable: 0 };
          const imported = await db.transactions
            .filter((tx) => tx.source === "import")
            .toArray();
          const matching = imported.filter((tx) =>
            ruleMatches(rule.match, subjectOf(tx, importId)),
          ).length;
          return { matching, applicable: (await ruleChanges([rule])).length };
        },
      );
    },

    async applyRules(ruleId) {
      const count = await db.transaction(
        "rw",
        [db.settings, db.rules, db.transactions, db.payees, db.reimbursements],
        async () => {
          let rules = await db.rules.toArray();
          if (ruleId !== undefined) {
            const rule = rules.find((r) => r.id === ruleId);
            if (!rule) throw new Error(`Rule ${ruleId} not found`);
            rules = [{ ...rule, enabled: true }];
          }
          return applyToNeverEdited(rules);
        },
      );
      if (count > 0) await dataChanged();
      return count;
    },

    async ruleSuggestion(transactionId) {
      return db.transaction("r", db.transactions, async () => {
        const tx = await db.transactions.get(transactionId);
        if (
          !tx ||
          tx.source !== "import" ||
          tx.type === "transfer" ||
          tx.categoryId === null ||
          tx.payeeId === null
        )
          return null;
        const text = suggestedRuleText(tx.bankConcept ?? "");
        if (text === "") return null;
        const others = await db.transactions
          .where("payeeId")
          .equals(tx.payeeId)
          .filter(
            (other) =>
              other.id !== tx.id &&
              other.source === "import" &&
              other.type !== "transfer" &&
              other.categoryId === null &&
              other.editedAt === null,
          )
          .count();
        return others > 0 ? { text, others } : null;
      });
    },

    async starterRulesOffer() {
      return db.transaction(
        "r",
        db.settings,
        db.rules,
        db.transactions,
        db.payees,
        async () => {
          if (
            (await setting<StarterRulesOffer | null>(
              STARTER_RULES_OFFER,
              null,
            )) !== "pending"
          )
            return null;
          const count = (await ruleChanges(await db.rules.toArray())).length;
          return count > 0 ? count : null;
        },
      );
    },

    async acceptStarterRulesOffer() {
      const count = await db.transaction(
        "rw",
        [db.settings, db.rules, db.transactions, db.payees, db.reimbursements],
        async () => {
          await setStarterRulesOffer("done");
          return applyToNeverEdited(await db.rules.toArray());
        },
      );
      if (count > 0) await dataChanged();
      else changed();
      return count;
    },

    async dismissStarterRulesOffer() {
      await setStarterRulesOffer("done");
      changed();
    },

    async listTransactions(period, filter: TransactionFilter = {}) {
      const txs = await (period === null
        ? db.transactions.toArray()
        : transactionsIn(period));
      const { accountId, categoryId, type, payeeId, from, to } = filter;
      const text = normalizeText(filter.text ?? "");
      const matching = txs.filter(
        (tx) =>
          (accountId === undefined ||
            tx.accountId === accountId ||
            tx.toAccountId === accountId) &&
          (categoryId === undefined ||
            (categoryId === null
              ? isUncategorized(tx)
              : tx.categoryId === categoryId)) &&
          (type === undefined || tx.type === type) &&
          (payeeId === undefined || tx.payeeId === payeeId) &&
          (from === undefined || tx.date >= from) &&
          (to === undefined || tx.date <= to),
      );
      const views = await toViews(await newestFirst(matching));
      return text === "" ? views : views.filter((tx) => matchesText(tx, text));
    },

    async transactionDateRange() {
      return db.transaction("r", db.transactions, async () => {
        const [first, last] = await Promise.all([
          db.transactions.orderBy("date").first(),
          db.transactions.orderBy("date").last(),
        ]);
        return first && last ? { first: first.date, last: last.date } : null;
      });
    },

    async getTransaction(id) {
      const tx = await db.transactions.get(id);
      return tx ? (await toViews([tx]))[0] : null;
    },

    async updateTransaction(id, changes: TransactionChanges) {
      const edited = await db.transaction(
        "rw",
        [
          db.transactions,
          db.payees,
          db.accounts,
          db.settings,
          db.reimbursements,
        ],
        async () => {
          const tx = await db.transactions.get(id);
          if (!tx) throw new Error(`Transaction ${id} not found`);
          const update: Partial<Transaction> = {};
          if (changes.transferAccountId !== undefined)
            Object.assign(
              update,
              await transferChange(tx, changes.transferAccountId),
            );
          // A transfer never has a category; one that stops being a transfer may get one in the same change.
          if ((update.type ?? tx.type) === "transfer") update.categoryId = null;
          else if (changes.categoryId !== undefined)
            update.categoryId = changes.categoryId;
          if (changes.note !== undefined) update.note = changes.note;
          if (changes.payeeName !== undefined)
            update.payeeId = await payeeIdFor(changes.payeeName);
          // Saving what it already has isn't an edit: the transaction stays as rules left it.
          if (!differs(tx, update)) return false;
          await db.transactions.update(id, {
            ...update,
            updatedAt: stamp(),
            editedAt: stamp(),
          });
          if (update.type === "transfer") await dropReimbursementsOf([id]);
          return true;
        },
      );
      if (edited) await dataChanged();
    },

    async deleteAdjustment(id) {
      const tx = await db.transactions.get(id);
      if (!tx || tx.source !== "adjustment")
        throw new Error("Only balance adjustments can be deleted");
      await db.transactions.delete(id);
      await dataChanged();
    },

    async expenseCategoriesUsedOn(date) {
      const txs = await db.transactions.where("date").equals(date).toArray();
      const counts = new Map<Id, number>();
      for (const tx of txs) {
        if (tx.type === "expense" && tx.categoryId)
          counts.set(tx.categoryId, (counts.get(tx.categoryId) ?? 0) + 1);
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id);
    },

    async reimbursementCandidates(
      incomeId,
      { text = "", before } = {},
    ): Promise<ReimbursementCandidate[]> {
      const tables = [
        db.transactions,
        db.reimbursements,
        db.settings,
        db.accounts,
        db.categories,
        db.payees,
      ];
      return db.transaction("r", tables, async () => {
        const income = await db.transactions.get(incomeId);
        if (!income || income.source !== "import" || income.type !== "income")
          return [];
        const own = await db.reimbursements
          .where("incomeId")
          .equals(incomeId)
          .toArray();
        const [recent, linked] = await Promise.all([
          db.transactions
            .where("date")
            .between(
              addDays(before ?? income.date, -REIMBURSEMENT_WINDOW_DAYS),
              income.date,
              true,
              true,
            )
            .toArray(),
          // What it already pays back stays editable, however old.
          db.transactions.bulkGet(own.map((link) => link.expenseId)),
        ]);
        const expenses = [
          ...new Map(
            [...recent, ...linked.filter(isDefined)].map((tx) => [tx.id, tx]),
          ).values(),
        ].filter((tx) => tx.source === "import" && tx.type === "expense");
        const { links } = await linksOf(expenses.map((tx) => tx.id));
        const parts = new Map(
          links
            .filter((link) => link.incomeId === incomeId)
            .map((link) => [link.expenseId, link.amount]),
        );
        const search = normalizeText(text);
        return (await toViews(await newestFirst(expenses)))
          .filter((tx) => matchesText(tx, search))
          .map((transaction) => ({
            transaction,
            left: leftToPayBack(transaction, links, incomeId),
            part: parts.get(transaction.id) ?? 0,
          }))
          .filter((candidate) => candidate.left > 0);
      });
    },

    async setReimbursements(incomeId, parts) {
      for (const part of parts) {
        checkWholeCents(part.amount, "A reimbursement");
        if (part.amount < 0)
          throw new Error(`A reimbursement can't be negative: ${part.amount}`);
      }
      if (new Set(parts.map((part) => part.expenseId)).size !== parts.length)
        throw new Error("An income pays back each expense once");
      const kept = parts.filter((part) => part.amount > 0);
      const edited = await db.transaction(
        "rw",
        db.transactions,
        db.reimbursements,
        async () => {
          const income = await db.transactions.get(incomeId);
          if (!income || income.source !== "import" || income.type !== "income")
            throw new Error(`${incomeId} isn't an imported income`);
          const spread = kept.reduce((sum, part) => sum + part.amount, 0);
          if (spread > income.amount)
            throw new Error(
              `The parts (${spread}) add up to more than the income (${income.amount})`,
            );
          const [expenses, { links }] = await Promise.all([
            db.transactions.bulkGet(kept.map((part) => part.expenseId)),
            linksOf(kept.map((part) => part.expenseId)),
          ]);
          kept.forEach((part, i) => {
            const expense = expenses[i];
            if (
              !expense ||
              expense.source !== "import" ||
              expense.type !== "expense"
            )
              throw new Error(`${part.expenseId} isn't an imported expense`);
            // What other incomes pay back of it stays; this income's own parts are being replaced.
            const left = leftToPayBack(expense, links, incomeId);
            if (part.amount > left)
              throw new Error(
                `The part (${part.amount}) is more than what's left of expense ${expense.id} (${left})`,
              );
          });
          const existing = await db.reimbursements
            .where("incomeId")
            .equals(incomeId)
            .toArray();
          const byExpense = new Map(
            existing.map((link) => [link.expenseId, link]),
          );
          // Saving the same parts again changes nothing.
          if (
            kept.length === existing.length &&
            kept.every(
              (part) => byExpense.get(part.expenseId)?.amount === part.amount,
            )
          )
            return false;
          await db.reimbursements.bulkDelete(existing.map((link) => link.id));
          await db.reimbursements.bulkAdd(
            kept.map(({ expenseId, amount }) => ({
              id: byExpense.get(expenseId)?.id ?? crypto.randomUUID(),
              incomeId,
              expenseId,
              amount,
            })),
          );
          return true;
        },
      );
      if (edited) await dataChanged();
    },

    async listPayees(): Promise<PayeeView[]> {
      // One payeeId per transaction that has a payee.
      const [payees, payeeIds] = await Promise.all([
        db.payees.toArray(),
        db.transactions.orderBy("payeeId").keys(),
      ]);
      const counts = new Map<unknown, number>();
      for (const payeeId of payeeIds)
        counts.set(payeeId, (counts.get(payeeId) ?? 0) + 1);
      return payees
        .map((payee) => ({
          ...payee,
          transactionCount: counts.get(payee.id) ?? 0,
        }))
        .sort((a, b) =>
          a.name.localeCompare(b.name, "es", { sensitivity: "base" }),
        );
    },

    async renamePayee(id, newName): Promise<PayeeRenameResult> {
      const name = tidyName(newName);
      if (name === "") return { ok: false, reason: "empty" };
      const normalized = normalizeText(name);
      let edited = false;
      const result = await db.transaction(
        "rw",
        db.payees,
        db.rules,
        async (): Promise<PayeeRenameResult> => {
          const existing = await db.payees
            .where("normalized")
            .equals(normalized)
            .first();
          if (existing && existing.id !== id)
            return { ok: false, reason: "exists", existing };
          const payee = await db.payees.get(id);
          if (payee?.name === name) return { ok: true };
          edited = true;
          await db.payees.update(id, { name, normalized });
          if (payee) await renameInRules([payee.normalized], name);
          return { ok: true };
        },
      );
      if (edited) await dataChanged();
      return result;
    },

    async mergePayees(keepId, mergeIds) {
      const merged = mergeIds.filter((id) => id !== keepId);
      if (merged.length === 0) return;
      await db.transaction(
        "rw",
        db.payees,
        db.transactions,
        db.rules,
        async () => {
          const kept = await db.payees.get(keepId);
          if (!kept) throw new Error(`Payee ${keepId} not found`);
          // Only the payee changes: category, note and the user's edited marker stay as they were.
          await db.transactions
            .where("payeeId")
            .anyOf(merged)
            .modify({ payeeId: keepId, updatedAt: stamp() });
          const gone = (await db.payees.bulkGet(merged)).filter(
            (payee) => payee !== undefined,
          );
          await db.payees.bulkDelete(merged);
          await renameInRules(
            gone.map((payee) => payee.normalized),
            kept.name,
          );
        },
      );
      await dataChanged();
    },

    async previewImport(file, fileName): Promise<PreviewResult> {
      const result = await readBbvaFile(file);
      if (!result.ok) return result;
      const accountId = await importAccountId();
      const existing = (await chainOf(accountId)).map(
        ({ bookingDate, amount, balance, tx }) => ({
          bookingDate,
          amount,
          balance,
          hash: tx.importHash!,
        }),
      );
      const rules = await db.rules.toArray();
      return {
        ok: true,
        preview: {
          fileName,
          accountId,
          plan: planImport(result.rows, existing, rules),
        },
      };
    },

    async replanImport(preview) {
      return {
        ...preview,
        plan: reapplyRules(preview.plan, await db.rules.toArray()),
      };
    },

    async commitImport(
      preview: ImportPreview,
      { exclude = [], categories = {} }: CommitImportOptions = {},
    ): Promise<ImportOutcome> {
      const excluded = new Set(exclude);
      const chosen = new Map(Object.entries(categories));
      const rows = preview.plan.rows.filter(
        (row) => row.status === "new" && !excluded.has(row.hash),
      );
      const batchId = crypto.randomUUID();
      const importedAt = stamp();

      await db.transaction(
        "rw",
        [
          db.transactions,
          db.payees,
          db.accounts,
          db.importBatches,
          db.settings,
        ],
        async () => {
          // A row may have been imported since the preview was made (e.g. in another tab).
          const already = new Set(
            (
              await db.transactions
                .where("importHash")
                .anyOf(rows.map((row) => row.hash))
                .toArray()
            ).map((tx) => tx.importHash),
          );
          const fresh = rows.filter((row) => !already.has(row.hash));
          // An account deleted since the preview was made can't take a transfer any more.
          const accountIds = new Set(
            await db.accounts.toCollection().primaryKeys(),
          );
          const txs: Transaction[] = [];
          for (const row of fresh) {
            // A category chosen in the preview is the user's edit, and wins over a transfer rule.
            const userChose = chosen.has(row.hash);
            const transferTo =
              !userChose &&
              row.transferAccountId !== null &&
              accountIds.has(row.transferAccountId)
                ? row.transferAccountId
                : null;
            txs.push({
              id: crypto.randomUUID(),
              ...shapeByBankSign(row.bankAmount, preview.accountId, transferTo),
              amount: row.amount,
              date: row.date,
              // One set by a rule isn't the user's edit; a transfer never has one.
              categoryId: userChose
                ? (chosen.get(row.hash) ?? null)
                : transferTo === null
                  ? row.categoryId
                  : null,
              payeeId: await payeeIdFor(row.payeeName),
              note: row.note,
              source: "import",
              importBatchId: batchId,
              importHash: row.hash,
              bookingDate: row.bookingDate,
              bankConcept: row.concept,
              bankMovement: row.movement,
              bankBalance: row.bankBalance,
              editedAt: userChose ? importedAt : null,
              createdAt: importedAt,
              updatedAt: importedAt,
            });
          }
          await db.transactions.bulkAdd(txs);
          await refreshOpeningBalance(preview.accountId);
          const check = (await computeBalanceCheck())!;
          await db.importBatches.add({
            id: batchId,
            importedAt,
            fileName: preview.fileName,
            accountId: preview.accountId,
            dateFrom: preview.plan.dateFrom,
            dateTo: preview.plan.dateTo,
            rows: preview.plan.rows.length,
            created: txs.length,
            skipped: preview.plan.rows.length - txs.length,
            bankBalance: check.bankBalance,
            appBalance: check.appBalance,
            undone: false,
          });
        },
      );
      await dataChanged();
      return {
        batch: (await db.importBatches.get(batchId))!,
        check: (await computeBalanceCheck())!,
      };
    },

    balanceCheck: computeBalanceCheck,

    async createBalanceAdjustment() {
      const check = await computeBalanceCheck();
      if (!check || check.difference === 0) return;
      await addBalanceAdjustment(await importAccountId(), check.difference);
      await dataChanged();
    },

    async listImports() {
      return (await db.importBatches
        .orderBy("importedAt")
        .reverse()
        .toArray()) as ImportBatch[];
    },

    async editedCountInImport(batchId) {
      return db.transactions
        .where("importBatchId")
        .equals(batchId)
        .filter((tx) => tx.editedAt !== null)
        .count();
    },

    async undoImport(batchId) {
      await db.transaction(
        "rw",
        [db.transactions, db.accounts, db.importBatches, db.settings],
        async () => {
          const batch = await db.importBatches.get(batchId);
          if (!batch || batch.undone) return;
          await db.transactions.where("importBatchId").equals(batchId).delete();
          await db.importBatches.update(batchId, { undone: true });
          await refreshOpeningBalance(batch.accountId);
        },
      );
      await dataChanged();
    },

    async home(month): Promise<HomeData> {
      const allAccounts = await repository.listAccounts();
      const accountId = await importAccountId();
      const [
        monthTxs,
        lastImport,
        chain,
        currentBudgets,
        goals,
        forecastTxs,
        backup,
      ] = await Promise.all([
        transactionsIn(month),
        db.importBatches
          .orderBy("importedAt")
          .reverse()
          .filter((batch) => !batch.undone)
          .first(),
        chainOf(accountId),
        // Budgets can only be acted on in the current month, whichever month Inicio shows.
        repository.budgets(monthOf(today(now()))),
        repository.listGoals(),
        // Expected charges look at the two months before.
        db.transactions
          .where("date")
          .between(`${addMonths(month, -2)}-01`, `${addMonths(month, 1)}-01`)
          .toArray(),
        repository.backupStatus(),
      ]);
      return {
        // Archived accounts still hold money: they count in the total, but aren't listed.
        totalBalance: allAccounts.reduce(
          (sum, account) => sum + account.balance,
          0,
        ),
        // Reimbursements make expenses smaller and aren't income; balances, goals and the forecast take the bank's amounts.
        summary: monthSummary(await netted(monthTxs), month),
        accounts: allAccounts.filter((account) => !account.archived),
        daysSinceLastImport: lastImport
          ? daysBetween(today(new Date(lastImport.importedAt)), today(now()))
          : null,
        // Of the month shown, like the Movimientos list its alert opens.
        uncategorized: monthTxs.filter(isUncategorized).length,
        gaps: findGaps(chain),
        budgetsOver: currentBudgets.budgets.filter(
          (budget) => budget.status === "over",
        ).length,
        topBudgets: [...currentBudgets.budgets]
          .sort((a, b) => b.percent - a.percent || b.spent - a.spent)
          .slice(0, TOP_BUDGETS),
        goals: goals.filter((goal) => !goal.archived),
        forecast: monthForecast(forecastTxs, month, today(now())),
        backupDue: backup.due,
      };
    },

    async spending(month): Promise<SpendingView> {
      return db.transaction(
        "r",
        db.categories,
        db.transactions,
        db.reimbursements,
        async () => {
          const [categories, txs] = await Promise.all([
            db.categories.orderBy("order").toArray(),
            transactionsIn(month),
          ]);
          const byId = new Map(
            categories.map((category) => [category.id, category]),
          );
          const { entries, total } = monthSpending(
            await netted(txs),
            month,
            categories.map((category) => category.id),
          );
          return {
            entries: entries.map(({ categoryId, ...entry }) => ({
              category: categoryId === null ? null : byId.get(categoryId)!,
              ...entry,
            })),
            total,
          };
        },
      );
    },

    async netWorth(): Promise<NetWorthView> {
      return db.transaction("r", db.accounts, db.transactions, async () => {
        const [accounts, txs] = await Promise.all([
          db.accounts.toArray(),
          db.transactions.toArray(),
        ]);
        const points = netWorthSeries(accounts, txs, today(now()));
        const latest = points.at(-1)?.netWorth ?? null;
        const previous = points.at(-2)?.netWorth ?? null;
        return {
          points,
          latest,
          change:
            latest !== null && previous !== null ? latest - previous : null,
        };
      });
    },

    async monthly(months): Promise<MonthlyView> {
      const currentMonth = monthOf(today(now()));
      return db.transaction(
        "r",
        db.transactions,
        db.reimbursements,
        async () => {
          const [txs, first] = await Promise.all([
            db.transactions
              .where("date")
              .between(
                `${addMonths(currentMonth, 1 - months)}-01`,
                `${addMonths(currentMonth, 1)}-01`,
              )
              .toArray(),
            // Balance adjustments aren't data: they only correct a balance.
            db.transactions
              .orderBy("date")
              .filter((tx) => tx.source === "import")
              .first(),
          ]);
          return {
            entries: monthlySeries(
              await netted(txs),
              currentMonth,
              months,
              first ? monthOf(first.date) : null,
            ),
          };
        },
      );
    },

    async budgets(month): Promise<BudgetsView> {
      return db.transaction(
        "r",
        db.categories,
        db.budgetLimits,
        db.transactions,
        db.reimbursements,
        async () => {
          const [categories, limits, txs] = await Promise.all([
            db.categories.orderBy("order").toArray(),
            db.budgetLimits.toArray(),
            transactionsIn(month),
          ]);
          const byId = new Map(
            categories.map((category) => [category.id, category]),
          );
          const {
            budgets,
            totals,
            today: marker,
          } = budgetMonth({
            month,
            categoryIds: categories.map((category) => category.id),
            limits,
            transactions: await netted(txs),
            today: today(now()),
          });
          return {
            budgets: budgets.map(({ categoryId, ...budget }) => ({
              category: byId.get(categoryId)!,
              ...budget,
            })),
            totals,
            today: marker,
          };
        },
      );
    },

    async budgetableCategories(month) {
      return db.transaction("r", db.categories, db.budgetLimits, async () => {
        const [categories, limits] = await Promise.all([
          db.categories.orderBy("order").toArray(),
          db.budgetLimits.toArray(),
        ]);
        return categories.filter(
          (category) =>
            category.kind === "expense" &&
            !category.archived &&
            limitFor(limits, category.id, month) <= 0,
        );
      });
    },

    async setBudgetLimit(
      categoryId,
      amount,
      fromMonth = monthOf(today(now())),
    ) {
      checkWholeCents(amount, "A budget limit");
      if (amount < 0)
        throw new Error(`A budget limit can't be negative: ${amount}`);
      checkMonth(fromMonth);
      await db.transaction("rw", db.categories, db.budgetLimits, async () => {
        const category = await db.categories.get(categoryId);
        if (!category) throw new Error(`Category ${categoryId} not found`);
        const limits = await limitsOf(categoryId).toArray();
        // A category made an income one after it got a budget can still have it removed.
        const removing =
          amount === 0 && limitFor(limits, categoryId, fromMonth) > 0;
        if (category.kind !== "expense" && !removing)
          throw new Error(
            `Only expense categories can have a budget, not ${category.name}`,
          );
        // "A partir de este mes": this month's limit is replaced and every later one goes.
        await db.budgetLimits.bulkDelete(
          limits
            .filter((limit) => limit.fromMonth > fromMonth)
            .map((limit) => limit.id),
        );
        const id =
          limits.find((limit) => limit.fromMonth === fromMonth)?.id ??
          crypto.randomUUID();
        await db.budgetLimits.put({ id, categoryId, fromMonth, amount });
      });
      await dataChanged();
    },

    async listGoals(): Promise<GoalView[]> {
      const [accounts, goals] = await Promise.all([
        repository.listAccounts(),
        db.goals.toArray(),
      ]);
      const byId = new Map(accounts.map((account) => [account.id, account]));
      const currentMonth = monthOf(today(now()));
      return goals
        .flatMap((goal) => {
          const account = byId.get(goal.accountId);
          // Account deletion takes its goals along; this skips any left by an account deleted before it did.
          return account
            ? [
                {
                  ...goal,
                  account,
                  ...goalProgress(
                    goal.target,
                    account.balance,
                    goal.targetMonth,
                    currentMonth,
                  ),
                },
              ]
            : [];
        })
        .sort(
          (a, b) =>
            a.account.order - b.account.order ||
            Number(a.archived) - Number(b.archived) ||
            a.name.localeCompare(b.name, "es"),
        );
    },

    async goalAccounts(goalId) {
      const [accounts, goals] = await Promise.all([
        repository.listAccounts(),
        db.goals.toArray(),
      ]);
      const ownAccountId = goals.find((goal) => goal.id === goalId)?.accountId;
      const taken = new Set(
        goals
          .filter((goal) => goal.id !== goalId && !goal.archived)
          .map((goal) => goal.accountId),
      );
      return accounts.filter(
        (account) =>
          account.id === ownAccountId ||
          (!account.archived && !taken.has(account.id)),
      );
    },

    async createGoal(draft: GoalDraft): Promise<GoalSaveResult> {
      const id = crypto.randomUUID();
      const name = tidyName(draft.name);
      const targetMonth = draft.targetMonth ?? null;
      checkGoalTarget(draft.target);
      if (targetMonth !== null) checkMonth(targetMonth);
      const result = await db.transaction(
        "rw",
        db.accounts,
        db.goals,
        async (): Promise<GoalSaveResult> => {
          await checkGoalAccount(draft.accountId, null);
          if (name === "") return { ok: false, reason: "empty" };
          const refused = await refuseGoalAccount(draft.accountId, id);
          if (refused) return refused;
          const { target, accountId, icon, color } = draft;
          await db.goals.add({
            id,
            name,
            target,
            targetMonth,
            accountId,
            icon,
            color,
            archived: false,
          });
          return { ok: true, id };
        },
      );
      if (result.ok) await dataChanged();
      return result;
    },

    async updateGoal(id, changes: GoalChanges): Promise<GoalSaveResult> {
      const { name, target, targetMonth, accountId, icon, color } = changes;
      // Only the fields given change.
      const update: Partial<Goal> = {
        ...(name !== undefined && { name: tidyName(name) }),
        ...(target !== undefined && { target }),
        ...(targetMonth !== undefined && { targetMonth }),
        ...(accountId !== undefined && { accountId }),
        ...(icon !== undefined && { icon }),
        ...(color !== undefined && { color }),
      };
      if (target !== undefined) checkGoalTarget(target);
      if (targetMonth !== undefined && targetMonth !== null)
        checkMonth(targetMonth);
      let edited = false;
      const result = await db.transaction(
        "rw",
        db.accounts,
        db.goals,
        async (): Promise<GoalSaveResult> => {
          const goal = await db.goals.get(id);
          if (!goal) throw new Error(`Goal ${id} not found`);
          if (accountId !== undefined)
            await checkGoalAccount(accountId, goal.accountId);
          if (update.name === "") return { ok: false, reason: "empty" };
          // An archived goal counts nothing twice: it's checked when unarchived.
          if (
            accountId !== undefined &&
            accountId !== goal.accountId &&
            !goal.archived
          ) {
            const refused = await refuseGoalAccount(accountId, id);
            if (refused) return refused;
          }
          edited = differs(goal, update);
          if (edited) await db.goals.update(id, update);
          return { ok: true, id };
        },
      );
      if (edited) await dataChanged();
      return result;
    },

    async setGoalArchived(id, archived): Promise<GoalSaveResult> {
      let edited = false;
      const result = await db.transaction(
        "rw",
        db.goals,
        async (): Promise<GoalSaveResult> => {
          const goal = await db.goals.get(id);
          if (!goal) throw new Error(`Goal ${id} not found`);
          if (goal.archived === archived) return { ok: true, id };
          const refused = archived
            ? null
            : await refuseGoalAccount(goal.accountId, id);
          if (refused) return refused;
          edited = true;
          await db.goals.update(id, { archived });
          return { ok: true, id };
        },
      );
      if (edited) await dataChanged();
      return result;
    },

    async deleteGoal(id) {
      await db.transaction("rw", db.goals, async () => {
        if (!(await db.goals.get(id))) throw new Error(`Goal ${id} not found`);
        await db.goals.delete(id);
      });
      await dataChanged();
    },

    async subscriptions(): Promise<SubscriptionsView> {
      return db.transaction(
        "r",
        db.categories,
        db.transactions,
        db.payees,
        db.reimbursements,
        async () => {
          // The category whose payees are the subscriptions, by name: it survives being recreated or seeded again.
          const category = await db.categories
            .filter((c) => normalizeText(c.name) === "suscripciones")
            .first();
          if (!category)
            return {
              subscriptions: [],
              totals: { monthly: 0, yearly: 0, spentThisMonth: 0 },
            };
          const date = today(now());
          const [charges, recent] = await Promise.all([
            db.transactions.where("categoryId").equals(category.id).toArray(),
            // Missing charges look at the two months before this one, whatever their category; this month's spending at this month.
            db.transactions
              .where("date")
              .between(
                `${addMonths(monthOf(date), -2)}-01`,
                `${addMonths(monthOf(date), 1)}-01`,
              )
              .toArray(),
          ]);
          const transactions = await netted([
            ...new Map(
              [...charges, ...recent].map((tx) => [tx.id, tx]),
            ).values(),
          ]);
          const list = subscriptions(transactions, category.id, date);
          const payees = await db.payees.bulkGet(
            list.map((subscription) => subscription.payeeId),
          );
          return {
            subscriptions: list
              .map((subscription, i) => ({
                ...subscription,
                payee: payees[i]!,
              }))
              .sort((a, b) =>
                a.payee.name.localeCompare(b.payee.name, "es-ES"),
              ),
            totals: subscriptionTotals(
              list,
              transactions,
              category.id,
              monthOf(date),
            ),
          };
        },
      );
    },

    async exportBackup(): Promise<BackupFile> {
      const tables = [
        db.accounts,
        db.categories,
        db.payees,
        db.transactions,
        db.rules,
        db.budgetLimits,
        db.goals,
        db.importBatches,
        db.reimbursements,
        db.settings,
      ];
      return db.transaction("r", tables, async () => {
        const [
          accounts,
          categories,
          payees,
          transactions,
          rules,
          budgetLimits,
          goals,
          importBatches,
          reimbursements,
          settings,
        ] = await Promise.all([
          db.accounts.toArray(),
          db.categories.toArray(),
          db.payees.toArray(),
          db.transactions.toArray(),
          db.rules.toArray(),
          db.budgetLimits.toArray(),
          db.goals.toArray(),
          db.importBatches.toArray(),
          db.reimbursements.toArray(),
          db.settings.toArray(),
        ]);
        // A link whose income or expense is gone or isn't one any more counts nowhere (`linksOf`): it stays out.
        const byId = new Map(transactions.map((tx) => [tx.id, tx]));
        const is = (id: Id, type: Transaction["type"]) =>
          byId.get(id)?.source === "import" && byId.get(id)?.type === type;
        const data = {
          accounts,
          categories,
          payees,
          transactions,
          rules,
          budgetLimits,
          goals,
          importBatches,
          reimbursements: reimbursements.filter(
            (link) =>
              is(link.incomeId, "income") && is(link.expenseId, "expense"),
          ),
          settings,
        };
        return createBackup(data, stamp(), appVersion);
      });
    },

    async markBackupMade() {
      await db.settings.put({ key: "lastBackupAt", value: stamp() });
      changed();
    },

    async backupStatus(): Promise<BackupStatus> {
      const lastBackupAt = await setting<string | null>("lastBackupAt", null);
      return {
        lastBackupAt,
        due: isBackupDue(
          await setting<string | null>("lastChangeAt", null),
          lastBackupAt,
          now(),
        ),
      };
    },

    readBackup,

    async dataCounts(): Promise<BackupCounts> {
      return countsOf((await repository.exportBackup()).data);
    },

    async restoreBackup(backup: BackupFile) {
      const { data, exportedAt } = backup;
      const tables = [
        db.accounts,
        db.categories,
        db.payees,
        db.transactions,
        db.rules,
        db.budgetLimits,
        db.goals,
        db.importBatches,
        db.reimbursements,
        db.settings,
      ];
      await db.transaction("rw", tables, async () => {
        // This phone's own settings stay (whether persistence was requested…); the backup's data settings replace the rest.
        const device = (await db.settings.toArray()).filter(
          (row) => !BACKUP_SETTINGS.includes(row.key),
        );
        await Promise.all(tables.map((table) => table.clear()));
        await db.accounts.bulkAdd(data.accounts);
        await db.categories.bulkAdd(data.categories);
        await db.payees.bulkAdd(data.payees);
        await db.transactions.bulkAdd(data.transactions);
        await db.rules.bulkAdd(data.rules);
        await db.budgetLimits.bulkAdd(data.budgetLimits);
        await db.goals.bulkAdd(data.goals);
        await db.importBatches.bulkAdd(data.importBatches);
        await db.reimbursements.bulkAdd(data.reimbursements);
        await db.settings.bulkPut([
          ...device,
          ...data.settings.filter((row) => BACKUP_SETTINGS.includes(row.key)),
          // A backup is only made once onboarding is done; a hand-edited one mustn't send the app back to it.
          { key: "onboardingDone", value: true },
          { key: "lastBackupAt", value: exportedAt },
          { key: "lastChangeAt", value: exportedAt },
        ]);
      });
      changed();
    },
  };

  return repository;
}
