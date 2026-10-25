import { KuentaDb } from './db';
import { STARTER_CATEGORIES, STARTER_DATA_VERSION, STARTER_RULES } from '../seed';
import { bankOrder, findGaps, latestBalanceOf, openingBalanceOf, type ChainLink } from '../../domain/chain';
import { planImport, reapplyRules } from '../../domain/importPlan';
import { applyRules as firstMatchActions, hasAction, ruleMatches, suggestedRuleText, type RuleSubject } from '../../domain/rules';
import { isUncategorized, monthlySeries, monthSpending, monthSummary } from '../../domain/stats';
import { monthForecast } from '../../domain/forecast';
import { subscriptions, subscriptionTotals } from '../../domain/subscriptions';
import { budgetMonth, limitFor } from '../../domain/budgets';
import { goalProgress } from '../../domain/goals';
import { addMonths, daysBetween, daysInMonth, isMonth, monthOf, today, type Month } from '../../domain/dates';
import { normalizeText } from '../../domain/text';
import { shapeByBankSign, transferAccountOf } from '../../domain/transfers';
import {
  signedAmount,
  type Account,
  type Goal,
  type Id,
  type ImportBatch,
  type Rule,
  type RuleActions,
  type RuleMatch,
  type Transaction,
} from '../../domain/model';
import { readBbvaFile } from '../../import/bbva/reader';
import type {
  AccountChanges,
  AccountDraft,
  AccountSaveResult,
  AccountView,
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
  NetWorthPoint,
  NetWorthView,
  PayeeRenameResult,
  PayeeView,
  PreviewResult,
  RuleChanges,
  RuleDraft,
  Settings,
  SpendingView,
  SubscriptionsView,
  TransactionChanges,
  TransactionFilter,
  TransactionView,
} from '../repository';

export interface DexieRepositoryOptions {
  /** IndexedDB database name. */
  name?: string;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

type Link = ChainLink & { tx: Transaction };

/** What applying rules changes on one transaction: its type, accounts and category, and its payee. */
type RuleChange = { id: Id; fields: Partial<Pick<Transaction, 'type' | 'accountId' | 'toAccountId' | 'categoryId'>>; payeeName?: string };

/** A payee name as stored: single spaces, no leading or trailing ones. */
const tidyName = (name: string) => name.replace(/\s+/g, ' ').trim();

/** A rule's actions as stored: a blank payee name is no action. */
function tidyActions(actions: RuleActions): RuleActions {
  const tidy: RuleActions = {};
  if (actions.categoryId !== undefined) tidy.categoryId = actions.categoryId;
  if (actions.transferAccountId !== undefined) tidy.transferAccountId = actions.transferAccountId;
  const payeeName = tidyName(actions.payeeName ?? '');
  if (payeeName !== '') tidy.payeeName = payeeName;
  return tidy;
}

/**
 * Setting for Inicio's offer to apply the starter rules to the transactions imported
 * before an update brought them: 'pending' until accepted or dismissed, then 'done'.
 * Absent when no update brought them (e.g. a first run).
 */
const STARTER_RULES_OFFER = 'starterRulesOffer';
type StarterRulesOffer = 'pending' | 'done';

/** How many budgets Inicio shows. */
const TOP_BUDGETS = 3;

export function createDexieRepository(options: DexieRepositoryOptions = {}): DataRepository {
  const db = new KuentaDb(options.name);
  const now = options.now ?? (() => new Date());
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());
  const stamp = () => now().toISOString();

  async function setting<T>(key: string, fallback: T): Promise<T> {
    const row = await db.settings.get(key);
    return row === undefined ? fallback : (row.value as T);
  }

  const setStarterRulesOffer = (state: StarterRulesOffer) => db.settings.put({ key: STARTER_RULES_OFFER, value: state });

  async function importAccountId(): Promise<Id> {
    const id = await setting<Id | null>('importAccountId', null);
    if (!id) throw new Error('No import account configured');
    return id;
  }

  /** The import account's imported transactions as links of the bank chain, in bank order. */
  async function chainOf(accountId: Id): Promise<Link[]> {
    const txs = await db.transactions.filter((tx) => tx.source === 'import').toArray();
    const links = txs
      .filter((tx) => tx.accountId === accountId || tx.toAccountId === accountId)
      .map((tx) => ({ bookingDate: tx.bookingDate!, amount: signedAmount(tx, accountId), balance: tx.bankBalance!, tx }));
    return bankOrder(links);
  }

  async function balanceOf(account: Account, txs: Transaction[]): Promise<number> {
    return txs.reduce((sum, tx) => sum + signedAmount(tx, account.id), account.openingBalance);
  }

  async function accountTransactions(accountId: Id): Promise<Transaction[]> {
    const [from, to] = await Promise.all([
      db.transactions.where('[accountId+date]').between([accountId, ''], [accountId, '￿']).toArray(),
      db.transactions.where('[toAccountId+date]').between([accountId, ''], [accountId, '￿']).toArray(),
    ]);
    return [...from, ...to];
  }

  /** Recomputes the import account's opening balance from the oldest imported row. */
  async function refreshOpeningBalance(accountId: Id) {
    const opening = openingBalanceOf(await chainOf(accountId)) ?? 0;
    await db.accounts.update(accountId, { openingBalance: opening, updatedAt: stamp() });
  }

  async function computeBalanceCheck(): Promise<BalanceCheck | null> {
    const accountId = await importAccountId();
    const bankBalance = latestBalanceOf(await chainOf(accountId));
    if (bankBalance === null) return null;
    const account = (await db.accounts.get(accountId))!;
    const appBalance = await balanceOf(account, await accountTransactions(accountId));
    return { bankBalance, appBalance, difference: bankBalance - appBalance };
  }

  /**
   * What an imported transaction changes to with this transfer account, or with none
   * (null): type and accounts by the bank's sign, and no category. Nothing when it already
   * is that. Throws for a balance adjustment, the import account, or an archived or unknown account.
   */
  async function transferChange(tx: Transaction, transferAccountId: Id | null): Promise<Partial<Transaction>> {
    const importId = await importAccountId();
    if (transferAccountId === transferAccountOf(tx, importId)) return {};
    if (tx.source !== 'import') throw new Error('Only imported transactions can be transfers');
    if (transferAccountId !== null) {
      const account = await db.accounts.get(transferAccountId);
      if (!account) throw new Error(`Account ${transferAccountId} not found`);
      if (account.archived) throw new Error(`Can't transfer to the archived account ${account.name}`);
    }
    return { ...shapeByBankSign(signedAmount(tx, importId), importId, transferAccountId), categoryId: null };
  }

  /**
   * Throws unless the rule can be saved: it needs a text; an action unless it's disabled
   * (deleting a category can leave a disabled rule without one, to be repointed); and a
   * category or a transfer account, never both. Its transfer account must exist and not be
   * the import account; an archived one is fine, so archiving never changes what rules do.
   * Call it inside a transaction on accounts and settings.
   */
  async function checkRule(rule: Rule) {
    if (normalizeText(rule.match.value) === '') throw new Error('A rule needs a text to match');
    if (rule.enabled && !hasAction(rule.actions)) throw new Error('An enabled rule needs a category, a transfer account or a payee name');
    const { categoryId, transferAccountId } = rule.actions;
    if (transferAccountId === undefined) return;
    if (categoryId !== undefined) throw new Error('A rule sets a category or a transfer account, never both');
    if (!(await db.accounts.get(transferAccountId))) throw new Error(`Account ${transferAccountId} not found`);
    if (transferAccountId === (await importAccountId())) throw new Error("A rule can't transfer to the import account");
  }

  async function payeeIdFor(name: string | null): Promise<Id | null> {
    const trimmed = tidyName(name ?? '');
    if (trimmed === '') return null;
    const normalized = normalizeText(trimmed);
    const existing = await db.payees.where('normalized').equals(normalized).first();
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
    const categoryIds = new Map(categories.map((category) => [normalizeText(category.name), category.id]));
    let categoryOrder = Math.max(-1, ...categories.map((category) => category.order));
    for (const starter of STARTER_CATEGORIES) {
      if (categoryIds.has(normalizeText(starter.name))) continue;
      const id = crypto.randomUUID();
      await db.categories.add({ ...starter, id, order: ++categoryOrder, archived: false });
      categoryIds.set(normalizeText(starter.name), id);
    }

    const matchKey = (match: RuleMatch) => [match.field, match.op, normalizeText(match.value), match.direction].join('|');
    const rules = await db.rules.toArray();
    const existingMatches = new Set(rules.map((rule) => matchKey(rule.match)));
    let ruleOrder = Math.max(-1, ...rules.map((rule) => rule.order));
    let added = 0;
    for (const starter of STARTER_RULES.filter((rule) => rule.since > fromVersion)) {
      if (existingMatches.has(matchKey(starter.match))) continue;
      added++;
      const actions: RuleActions = { categoryId: categoryIds.get(normalizeText(starter.category))! };
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
    await db.settings.put({ key: 'starterDataVersion', value: STARTER_DATA_VERSION });
    return added;
  }

  /**
   * What rules look at in an imported transaction. The amount is the bank's, as seen from
   * the import account, so a transfer coming back from Revolut is still a credit.
   */
  const subjectOf = (tx: Transaction, importId: Id): RuleSubject => ({
    concept: tx.bankConcept ?? '',
    movement: tx.bankMovement ?? '',
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
    const importId = await setting<Id | null>('importAccountId', null);
    if (importId === null) return [];
    const [txs, payees] = await Promise.all([
      db.transactions.filter((tx) => tx.source === 'import' && tx.editedAt === null).toArray(),
      db.payees.toArray(),
    ]);
    const payeeNames = new Map(payees.map((payee) => [payee.id, payee.normalized]));
    const changes: RuleChange[] = [];
    for (const tx of txs) {
      const subject = subjectOf(tx, importId);
      const actions = firstMatchActions(rules, subject);
      if (!actions) continue;
      const change: RuleChange = { id: tx.id, fields: {} };
      const transferAccountId = transferAccountOf(tx, importId);
      if (actions.transferAccountId !== undefined) {
        if (actions.transferAccountId !== transferAccountId) {
          change.fields = { ...shapeByBankSign(subject.amount, importId, actions.transferAccountId), categoryId: null };
        }
      } else if (actions.categoryId !== undefined) {
        if (transferAccountId !== null) {
          change.fields = { ...shapeByBankSign(subject.amount, importId, null), categoryId: actions.categoryId };
        } else if (actions.categoryId !== tx.categoryId) {
          change.fields = { categoryId: actions.categoryId };
        }
      }
      const payeeName = tidyName(actions.payeeName ?? '');
      if (payeeName !== '' && normalizeText(payeeName) !== (tx.payeeId && payeeNames.get(tx.payeeId))) change.payeeName = payeeName;
      if (Object.keys(change.fields).length > 0 || change.payeeName !== undefined) changes.push(change);
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
      const update: Partial<Transaction> = { ...change.fields, updatedAt: stamp() };
      if (change.payeeName !== undefined) update.payeeId = await payeeIdFor(change.payeeName);
      await db.transactions.update(change.id, update);
    }
    return changes.length;
  }

  // On startup, an install made by an older version gets the starter data added since.
  // The first run seeds the current version itself (completeOnboarding). If it fails,
  // nothing is written, the app still opens and the next startup tries again.
  // When the new starter rules would change transactions already imported, Inicio
  // offers to apply them (STARTER_RULES_OFFER).
  db.on('ready', () =>
    db
      .transaction('rw', [db.categories, db.rules, db.settings, db.transactions, db.payees], async () => {
        if (!(await setting('onboardingDone', false))) return;
        const version = await setting('starterDataVersion', 1);
        if (version >= STARTER_DATA_VERSION) return;
        const addedRules = await addStarterData(version);
        if (addedRules > 0 && (await ruleChanges(await db.rules.toArray())).length > 0) {
          await setStarterRulesOffer('pending');
        }
      })
      .catch((error: unknown) => console.error('Could not add the starter data', error)),
  );

  /** Points rules that set one of these payees (by normalized name) to the payee's new name. */
  async function renameInRules(normalizedNames: string[], name: string) {
    const targets = new Set(normalizedNames);
    await db.rules
      .filter((rule) => rule.actions.payeeName !== undefined && targets.has(normalizeText(rule.actions.payeeName)))
      .modify((rule) => {
        rule.actions = { ...rule.actions, payeeName: name };
      });
  }

  /** Why a category can't take this name: it's empty, or another category has it ignoring case and accents. */
  async function refuseCategoryName(name: string, ownId: Id): Promise<CategorySaveResult | null> {
    if (name === '') return { ok: false, reason: 'empty' };
    const normalized = normalizeText(name);
    const existing = await db.categories.filter((category) => category.id !== ownId && normalizeText(category.name) === normalized).first();
    return existing ? { ok: false, reason: 'exists', existing } : null;
  }

  /** Why an account can't take this name: it's empty, or another account has it ignoring case and accents. */
  async function refuseAccountName(name: string, ownId: Id): Promise<AccountSaveResult | null> {
    if (name === '') return { ok: false, reason: 'empty' };
    const normalized = normalizeText(name);
    const existing = await db.accounts.filter((account) => account.id !== ownId && normalizeText(account.name) === normalized).first();
    return existing ? { ok: false, reason: 'exists', existing } : null;
  }

  function checkWholeCents(cents: number, what: string) {
    if (!Number.isSafeInteger(cents)) throw new Error(`${what} must be whole cents, not ${cents}`);
  }

  function checkMonth(month: Month) {
    if (!isMonth(month)) throw new Error(`Not a month: ${month}`);
  }

  function checkGoalTarget(target: number) {
    checkWholeCents(target, 'A goal target');
    if (target <= 0) throw new Error(`A goal target must be above 0, not ${target}`);
  }

  /** A goal can go on any account but an archived one, except the one it's already on. */
  async function checkGoalAccount(accountId: Id, ownAccountId: Id | null) {
    const account = await db.accounts.get(accountId);
    if (!account) throw new Error(`Account ${accountId} not found`);
    if (account.archived && accountId !== ownAccountId) throw new Error(`Account ${account.name} is archived: it can't get a goal`);
  }

  /** Why a goal can't be on this account: another non-archived goal (`existing`) already is, so its money would count twice. */
  async function refuseGoalAccount(accountId: Id, ownId: Id): Promise<GoalSaveResult | null> {
    const existing = await db.goals
      .where('accountId')
      .equals(accountId)
      .filter((goal) => goal.id !== ownId && !goal.archived)
      .first();
    return existing ? { ok: false, reason: 'taken', existing } : null;
  }

  /** The account, unless it's missing or the import account (which `action` doesn't apply to). */
  async function nonImportedAccount(id: Id, action: string): Promise<Account> {
    const account = await db.accounts.get(id);
    if (!account) throw new Error(`Account ${id} not found`);
    if (id === (await importAccountId())) throw new Error(`The import account can't ${action}`);
    return account;
  }

  /** An uncategorized balance adjustment of `difference` (signed, not 0) on the account, dated today. */
  async function addBalanceAdjustment(accountId: Id, difference: number) {
    const createdAt = stamp();
    await db.transactions.add({
      id: crypto.randomUUID(),
      type: difference > 0 ? 'income' : 'expense',
      amount: Math.abs(difference),
      date: today(now()),
      accountId,
      toAccountId: null,
      categoryId: null,
      payeeId: null,
      note: 'Ajuste de saldo',
      source: 'adjustment',
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

  async function toViews(txs: Transaction[]): Promise<TransactionView[]> {
    const [accounts, categories, payees] = await Promise.all([
      db.accounts.toArray(),
      db.categories.toArray(),
      db.payees.bulkGet([...new Set(txs.map((tx) => tx.payeeId).filter((id): id is Id => id !== null))]),
    ]);
    const byId = <T extends { id: Id }>(items: (T | undefined)[]) =>
      new Map(items.filter((item): item is T => item !== undefined).map((item) => [item.id, item]));
    const accountMap = byId(accounts);
    const categoryMap = byId(categories);
    const payeeMap = byId(payees);
    return txs.map((tx) => ({
      ...tx,
      account: accountMap.get(tx.accountId)!,
      toAccount: tx.toAccountId ? accountMap.get(tx.toAccountId) ?? null : null,
      category: tx.categoryId ? categoryMap.get(tx.categoryId) ?? null : null,
      payee: tx.payeeId ? payeeMap.get(tx.payeeId) ?? null : null,
    }));
  }

  /** A month's transactions, by their date. */
  const transactionsIn = (month: Month) => db.transactions.where('date').between(`${month}-01`, `${addMonths(month, 1)}-01`).toArray();

  /** A category's budget limits, of every month. */
  const limitsOf = (categoryId: Id) => db.budgetLimits.where('[categoryId+fromMonth]').between([categoryId, ''], [categoryId, '￿']);

  /**
   * Newest first: by date and, within a date, imported transactions in reverse bank order. The
   * bank order comes from the import account's whole chain, so it holds for a filtered list too.
   */
  async function newestFirst(txs: Transaction[]): Promise<Transaction[]> {
    const accountId = await setting<Id | null>('importAccountId', null);
    const bankIndex = new Map((accountId ? await chainOf(accountId) : []).map((link, index) => [link.tx.id, index]));
    const position = (tx: Transaction) => bankIndex.get(tx.id) ?? -1;
    return txs.sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.bookingDate ?? '').localeCompare(a.bookingDate ?? '') ||
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
        onboardingDone: await setting('onboardingDone', false),
        importAccountId: await setting<Id | null>('importAccountId', null),
        persistRequested: await setting('persistRequested', false),
      };
    },

    async setPersistRequested() {
      await db.settings.put({ key: 'persistRequested', value: true });
      changed();
    },

    async completeOnboarding({ importAccountName }) {
      const createdAt = stamp();
      const accountId = crypto.randomUUID();
      await db.transaction('rw', [db.accounts, db.categories, db.rules, db.settings], async () => {
        await db.accounts.add({
          id: accountId,
          name: importAccountName.trim() || 'BBVA',
          type: 'bank',
          openingBalance: 0,
          color: 'blue',
          icon: 'landmark',
          archived: false,
          order: 0,
          createdAt,
          updatedAt: createdAt,
        });
        await addStarterData(0);
        await db.settings.bulkPut([
          { key: 'importAccountId', value: accountId },
          { key: 'onboardingDone', value: true },
        ]);
      });
      changed();
    },

    async listAccounts(): Promise<AccountView[]> {
      const importId = await setting<Id | null>('importAccountId', null);
      const accounts = await db.accounts.orderBy('order').toArray();
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
      checkWholeCents(openingBalance, 'An opening balance');
      const result = await db.transaction('rw', db.accounts, async (): Promise<AccountSaveResult> => {
        const refused = await refuseAccountName(name, id);
        if (refused) return refused;
        const last = await db.accounts.orderBy('order').last();
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
      });
      if (result.ok) changed();
      return result;
    },

    async updateAccount(id, changes: AccountChanges): Promise<AccountSaveResult> {
      const update = changes.name === undefined ? { ...changes } : { ...changes, name: tidyName(changes.name) };
      if (update.openingBalance !== undefined) {
        checkWholeCents(update.openingBalance, 'An opening balance');
        // The import account's opening balance follows its imports (see refreshOpeningBalance).
        if (id === (await importAccountId())) throw new Error("The import account's opening balance comes from its imports");
      }
      const result = await db.transaction('rw', db.accounts, async (): Promise<AccountSaveResult> => {
        if (!(await db.accounts.get(id))) throw new Error(`Account ${id} not found`);
        const refused = update.name === undefined ? null : await refuseAccountName(update.name, id);
        if (refused) return refused;
        await db.accounts.update(id, { ...update, updatedAt: stamp() });
        return { ok: true, id };
      });
      if (result.ok) changed();
      return result;
    },

    async updateAccountBalance(id, balance) {
      checkWholeCents(balance, 'A balance');
      const difference = await db.transaction('rw', db.accounts, db.transactions, db.settings, async () => {
        const account = await nonImportedAccount(id, 'have its balance typed');
        const difference = balance - (await balanceOf(account, await accountTransactions(id)));
        if (difference !== 0) await addBalanceAdjustment(id, difference);
        return difference;
      });
      if (difference !== 0) changed();
      return difference;
    },

    async setAccountArchived(id, archived) {
      await db.transaction('rw', db.accounts, db.settings, async () => {
        await nonImportedAccount(id, 'be archived');
        await db.accounts.update(id, { archived, updatedAt: stamp() });
      });
      changed();
    },

    async deleteAccount(id) {
      await db.transaction('rw', [db.accounts, db.transactions, db.settings, db.rules, db.goals], async () => {
        await nonImportedAccount(id, 'be deleted');
        const count = (await accountTransactions(id)).length;
        if (count > 0) throw new Error(`Account ${id} has ${count} transactions: archive it instead`);
        // Disabled rather than deleted, so the user can repoint them; any payee action stays.
        await db.rules
          .filter((rule) => rule.actions.transferAccountId === id)
          .modify((rule) => {
            delete rule.actions.transferAccountId;
            rule.enabled = false;
          });
        await db.goals.where('accountId').equals(id).delete();
        await db.accounts.delete(id);
      });
      changed();
    },

    async listCategories({ withArchived = false } = {}) {
      const categories = await db.categories.orderBy('order').toArray();
      const active = categories.filter((category) => !category.archived);
      return withArchived ? [...active, ...categories.filter((category) => category.archived)] : active;
    },

    async createCategory(draft: CategoryDraft): Promise<CategorySaveResult> {
      const id = crypto.randomUUID();
      const name = tidyName(draft.name);
      const result = await db.transaction('rw', db.categories, async (): Promise<CategorySaveResult> => {
        const refused = await refuseCategoryName(name, id);
        if (refused) return refused;
        const last = await db.categories.orderBy('order').last();
        await db.categories.add({ ...draft, name, id, order: last ? last.order + 1 : 0, archived: false });
        return { ok: true, id };
      });
      if (result.ok) changed();
      return result;
    },

    async updateCategory(id, changes: CategoryChanges): Promise<CategorySaveResult> {
      const update = changes.name === undefined ? { ...changes } : { ...changes, name: tidyName(changes.name) };
      const result = await db.transaction('rw', db.categories, async (): Promise<CategorySaveResult> => {
        if (!(await db.categories.get(id))) throw new Error(`Category ${id} not found`);
        const refused = update.name === undefined ? null : await refuseCategoryName(update.name, id);
        if (refused) return refused;
        await db.categories.update(id, update);
        return { ok: true, id };
      });
      if (result.ok) changed();
      return result;
    },

    async moveCategory(id, direction) {
      await db.transaction('rw', db.categories, async () => {
        const category = await db.categories.get(id);
        if (!category) throw new Error(`Category ${id} not found`);
        const sameKind = await db.categories
          .orderBy('order')
          .filter((other) => other.kind === category.kind && !other.archived)
          .toArray();
        const neighbour = sameKind[sameKind.findIndex((other) => other.id === id) + (direction === 'up' ? -1 : 1)];
        if (!neighbour) return;
        await db.categories.update(id, { order: neighbour.order });
        await db.categories.update(neighbour.id, { order: category.order });
      });
      changed();
    },

    async categoryUsage(id): Promise<CategoryUsage> {
      const [transactions, rules, budgets] = await Promise.all([
        db.transactions.where('categoryId').equals(id).count(),
        db.rules.filter((rule) => rule.actions.categoryId === id).count(),
        limitsOf(id).filter((limit) => limit.amount > 0).count(),
      ]);
      return { transactions, rules, budget: budgets > 0 };
    },

    async deleteCategory(id, moveTo) {
      await db.transaction('rw', [db.categories, db.transactions, db.rules, db.budgetLimits], async () => {
        if (!(await db.categories.get(id))) throw new Error(`Category ${id} not found`);
        if (moveTo === id || (moveTo !== null && !(await db.categories.get(moveTo)))) {
          throw new Error(`Can't move the transactions of category ${id} to ${moveTo}`);
        }
        // Only the category changes: the user's edited marker and every amount stay as they were.
        await db.transactions.where('categoryId').equals(id).modify({ categoryId: moveTo, updatedAt: stamp() });
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
      });
      changed();
    },

    async listRules() {
      return db.rules.orderBy('order').toArray();
    },

    async createRule(draft: RuleDraft) {
      const id = crypto.randomUUID();
      await db.transaction('rw', db.rules, db.accounts, db.settings, async () => {
        // A user's rule goes before every other, starter rules included, so it wins.
        const first = await db.rules.orderBy('order').first();
        const rule: Rule = {
          id,
          name: draft.name,
          order: first ? first.order - 1 : 0,
          enabled: draft.enabled ?? true,
          match: { field: 'conceptOrMovement', op: 'contains', direction: 'any', ...draft.match },
          actions: tidyActions(draft.actions),
        };
        // A new rule needs an action even when it starts disabled.
        await checkRule({ ...rule, enabled: true });
        await db.rules.add(rule);
      });
      changed();
      return id;
    },

    async updateRule(id, changes: RuleChanges) {
      await db.transaction('rw', db.rules, db.accounts, db.settings, async () => {
        const rule = await db.rules.get(id);
        if (!rule) throw new Error(`Rule ${id} not found`);
        const updated: Rule = {
          ...rule,
          ...changes,
          match: { ...rule.match, ...changes.match },
          actions: tidyActions(changes.actions ?? rule.actions),
        };
        await checkRule(updated);
        await db.rules.put(updated);
      });
      changed();
    },

    async moveRule(id, direction) {
      await db.transaction('rw', db.rules, async () => {
        const rules = await db.rules.orderBy('order').toArray();
        const index = rules.findIndex((rule) => rule.id === id);
        if (index < 0) throw new Error(`Rule ${id} not found`);
        const neighbour = rules[index + (direction === 'up' ? -1 : 1)];
        if (!neighbour) return;
        await db.rules.update(id, { order: neighbour.order });
        await db.rules.update(neighbour.id, { order: rules[index].order });
      });
      changed();
    },

    async deleteRule(id) {
      // Transactions don't remember which rule set them, so nothing else changes.
      await db.rules.delete(id);
      changed();
    },

    async previewRule(draft) {
      const rule: Rule = {
        id: 'draft',
        name: '',
        order: 0,
        enabled: true,
        match: { field: 'conceptOrMovement', op: 'contains', direction: 'any', ...draft.match },
        actions: draft.actions,
      };
      return db.transaction('r', db.settings, db.transactions, db.payees, async () => {
        const importId = await setting<Id | null>('importAccountId', null);
        if (importId === null) return { matching: 0, applicable: 0 };
        const imported = await db.transactions.filter((tx) => tx.source === 'import').toArray();
        const matching = imported.filter((tx) => ruleMatches(rule.match, subjectOf(tx, importId))).length;
        return { matching, applicable: (await ruleChanges([rule])).length };
      });
    },

    async applyRules(ruleId) {
      const count = await db.transaction('rw', db.settings, db.rules, db.transactions, db.payees, async () => {
        let rules = await db.rules.toArray();
        if (ruleId !== undefined) {
          const rule = rules.find((r) => r.id === ruleId);
          if (!rule) throw new Error(`Rule ${ruleId} not found`);
          rules = [{ ...rule, enabled: true }];
        }
        return applyToNeverEdited(rules);
      });
      if (count > 0) changed();
      return count;
    },

    async ruleSuggestion(transactionId) {
      return db.transaction('r', db.transactions, async () => {
        const tx = await db.transactions.get(transactionId);
        if (!tx || tx.source !== 'import' || tx.type === 'transfer' || tx.categoryId === null || tx.payeeId === null) return null;
        const text = suggestedRuleText(tx.bankConcept ?? '');
        if (text === '') return null;
        const others = await db.transactions
          .where('payeeId')
          .equals(tx.payeeId)
          .filter(
            (other) =>
              other.id !== tx.id && other.source === 'import' && other.type !== 'transfer' && other.categoryId === null && other.editedAt === null,
          )
          .count();
        return others > 0 ? { text, others } : null;
      });
    },

    async starterRulesOffer() {
      return db.transaction('r', db.settings, db.rules, db.transactions, db.payees, async () => {
        if ((await setting<StarterRulesOffer | null>(STARTER_RULES_OFFER, null)) !== 'pending') return null;
        const count = (await ruleChanges(await db.rules.toArray())).length;
        return count > 0 ? count : null;
      });
    },

    async acceptStarterRulesOffer() {
      const count = await db.transaction('rw', db.settings, db.rules, db.transactions, db.payees, async () => {
        await setStarterRulesOffer('done');
        return applyToNeverEdited(await db.rules.toArray());
      });
      changed();
      return count;
    },

    async dismissStarterRulesOffer() {
      await setStarterRulesOffer('done');
      changed();
    },

    async listTransactions(period, filter: TransactionFilter = {}) {
      const txs = await (period === null ? db.transactions.toArray() : transactionsIn(period));
      const { accountId, categoryId, type, payeeId } = filter;
      const text = normalizeText(filter.text ?? '');
      const matching = txs.filter(
        (tx) =>
          (accountId === undefined || tx.accountId === accountId || tx.toAccountId === accountId) &&
          (categoryId === undefined || (categoryId === null ? isUncategorized(tx) : tx.categoryId === categoryId)) &&
          (type === undefined || tx.type === type) &&
          (payeeId === undefined || tx.payeeId === payeeId),
      );
      const views = await toViews(await newestFirst(matching));
      if (text === '') return views;
      return views.filter((tx) =>
        [tx.payee?.name, tx.note, tx.bankConcept, tx.bankMovement].some((field) => field && normalizeText(field).includes(text)),
      );
    },

    async getTransaction(id) {
      const tx = await db.transactions.get(id);
      return tx ? (await toViews([tx]))[0] : null;
    },

    async updateTransaction(id, changes: TransactionChanges) {
      await db.transaction('rw', [db.transactions, db.payees, db.accounts, db.settings], async () => {
        const tx = await db.transactions.get(id);
        if (!tx) throw new Error(`Transaction ${id} not found`);
        const update: Partial<Transaction> = { updatedAt: stamp(), editedAt: stamp() };
        if (changes.transferAccountId !== undefined) Object.assign(update, await transferChange(tx, changes.transferAccountId));
        // A transfer never has a category; one that stops being a transfer may get one in the same change.
        if ((update.type ?? tx.type) === 'transfer') update.categoryId = null;
        else if (changes.categoryId !== undefined) update.categoryId = changes.categoryId;
        if (changes.note !== undefined) update.note = changes.note;
        if (changes.payeeName !== undefined) update.payeeId = await payeeIdFor(changes.payeeName);
        await db.transactions.update(id, update);
      });
      changed();
    },

    async deleteAdjustment(id) {
      const tx = await db.transactions.get(id);
      if (!tx || tx.source !== 'adjustment') throw new Error('Only balance adjustments can be deleted');
      await db.transactions.delete(id);
      changed();
    },

    async expenseCategoriesUsedOn(date) {
      const txs = await db.transactions.where('date').equals(date).toArray();
      const counts = new Map<Id, number>();
      for (const tx of txs) {
        if (tx.type === 'expense' && tx.categoryId) counts.set(tx.categoryId, (counts.get(tx.categoryId) ?? 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    },

    async listPayees(): Promise<PayeeView[]> {
      // One payeeId per transaction that has a payee.
      const [payees, payeeIds] = await Promise.all([db.payees.toArray(), db.transactions.orderBy('payeeId').keys()]);
      const counts = new Map<unknown, number>();
      for (const payeeId of payeeIds) counts.set(payeeId, (counts.get(payeeId) ?? 0) + 1);
      return payees
        .map((payee) => ({ ...payee, transactionCount: counts.get(payee.id) ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    },

    async renamePayee(id, newName): Promise<PayeeRenameResult> {
      const name = tidyName(newName);
      if (name === '') return { ok: false, reason: 'empty' };
      const normalized = normalizeText(name);
      const result = await db.transaction('rw', db.payees, db.rules, async (): Promise<PayeeRenameResult> => {
        const existing = await db.payees.where('normalized').equals(normalized).first();
        if (existing && existing.id !== id) return { ok: false, reason: 'exists', existing };
        const payee = await db.payees.get(id);
        await db.payees.update(id, { name, normalized });
        if (payee) await renameInRules([payee.normalized], name);
        return { ok: true };
      });
      if (result.ok) changed();
      return result;
    },

    async mergePayees(keepId, mergeIds) {
      const merged = mergeIds.filter((id) => id !== keepId);
      if (merged.length === 0) return;
      await db.transaction('rw', db.payees, db.transactions, db.rules, async () => {
        const kept = await db.payees.get(keepId);
        if (!kept) throw new Error(`Payee ${keepId} not found`);
        // Only the payee changes: category, note and the user's edited marker stay as they were.
        await db.transactions.where('payeeId').anyOf(merged).modify({ payeeId: keepId, updatedAt: stamp() });
        const gone = (await db.payees.bulkGet(merged)).filter((payee) => payee !== undefined);
        await db.payees.bulkDelete(merged);
        await renameInRules(gone.map((payee) => payee.normalized), kept.name);
      });
      changed();
    },

    async previewImport(file, fileName): Promise<PreviewResult> {
      const result = await readBbvaFile(file);
      if (!result.ok) return result;
      const accountId = await importAccountId();
      const existing = (await chainOf(accountId)).map(({ bookingDate, amount, balance, tx }) => ({
        bookingDate,
        amount,
        balance,
        hash: tx.importHash!,
      }));
      const rules = await db.rules.toArray();
      return { ok: true, preview: { fileName, accountId, plan: planImport(result.rows, existing, rules) } };
    },

    async replanImport(preview) {
      return { ...preview, plan: reapplyRules(preview.plan, await db.rules.toArray()) };
    },

    async commitImport(preview: ImportPreview, { exclude = [], categories = {} }: CommitImportOptions = {}): Promise<ImportOutcome> {
      const excluded = new Set(exclude);
      const chosen = new Map(Object.entries(categories));
      const rows = preview.plan.rows.filter((row) => row.status === 'new' && !excluded.has(row.hash));
      const batchId = crypto.randomUUID();
      const importedAt = stamp();

      await db.transaction('rw', [db.transactions, db.payees, db.accounts, db.importBatches, db.settings], async () => {
        // A row may have been imported since the preview was made (e.g. in another tab).
        const already = new Set(
          (await db.transactions.where('importHash').anyOf(rows.map((row) => row.hash)).toArray()).map((tx) => tx.importHash),
        );
        const fresh = rows.filter((row) => !already.has(row.hash));
        // An account deleted since the preview was made can't take a transfer any more.
        const accountIds = new Set(await db.accounts.toCollection().primaryKeys());
        const txs: Transaction[] = [];
        for (const row of fresh) {
          // A category chosen in the preview is the user's edit, and wins over a transfer rule.
          const userChose = chosen.has(row.hash);
          const transferTo = !userChose && row.transferAccountId !== null && accountIds.has(row.transferAccountId) ? row.transferAccountId : null;
          txs.push({
            id: crypto.randomUUID(),
            ...shapeByBankSign(row.bankAmount, preview.accountId, transferTo),
            amount: row.amount,
            date: row.date,
            // One set by a rule isn't the user's edit; a transfer never has one.
            categoryId: userChose ? (chosen.get(row.hash) ?? null) : transferTo === null ? row.categoryId : null,
            payeeId: await payeeIdFor(row.payeeName),
            note: row.note,
            source: 'import',
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
      });
      changed();
      return { batch: (await db.importBatches.get(batchId))!, check: (await computeBalanceCheck())! };
    },

    balanceCheck: computeBalanceCheck,

    async createBalanceAdjustment() {
      const check = await computeBalanceCheck();
      if (!check || check.difference === 0) return;
      await addBalanceAdjustment(await importAccountId(), check.difference);
      changed();
    },

    async listImports() {
      return (await db.importBatches.orderBy('importedAt').reverse().toArray()) as ImportBatch[];
    },

    async editedCountInImport(batchId) {
      return db.transactions.where('importBatchId').equals(batchId).filter((tx) => tx.editedAt !== null).count();
    },

    async undoImport(batchId) {
      await db.transaction('rw', [db.transactions, db.accounts, db.importBatches, db.settings], async () => {
        const batch = await db.importBatches.get(batchId);
        if (!batch || batch.undone) return;
        await db.transactions.where('importBatchId').equals(batchId).delete();
        await db.importBatches.update(batchId, { undone: true });
        await refreshOpeningBalance(batch.accountId);
      });
      changed();
    },

    async home(month): Promise<HomeData> {
      const allAccounts = await repository.listAccounts();
      const accountId = await importAccountId();
      const [monthTxs, lastImport, chain, currentBudgets, goals, forecastTxs] = await Promise.all([
        transactionsIn(month),
        db.importBatches.orderBy('importedAt').reverse().filter((batch) => !batch.undone).first(),
        chainOf(accountId),
        // Budgets can only be acted on in the current month, whichever month Inicio shows.
        repository.budgets(monthOf(today(now()))),
        repository.listGoals(),
        // Expected charges look at the two months before.
        db.transactions.where('date').between(`${addMonths(month, -2)}-01`, `${addMonths(month, 1)}-01`).toArray(),
      ]);
      return {
        // Archived accounts still hold money: they count in the total, but aren't listed.
        totalBalance: allAccounts.reduce((sum, account) => sum + account.balance, 0),
        summary: monthSummary(monthTxs, month),
        accounts: allAccounts.filter((account) => !account.archived),
        daysSinceLastImport: lastImport ? daysBetween(today(new Date(lastImport.importedAt)), today(now())) : null,
        // Of the month shown, like the Movimientos list its alert opens.
        uncategorized: monthTxs.filter(isUncategorized).length,
        gaps: findGaps(chain),
        budgetsOver: currentBudgets.budgets.filter((budget) => budget.status === 'over').length,
        topBudgets: [...currentBudgets.budgets].sort((a, b) => b.percent - a.percent || b.spent - a.spent).slice(0, TOP_BUDGETS),
        goals: goals.filter((goal) => !goal.archived),
        forecast: monthForecast(forecastTxs, month, today(now())),
      };
    },

    async spending(month): Promise<SpendingView> {
      return db.transaction('r', db.categories, db.transactions, async () => {
        const [categories, txs] = await Promise.all([db.categories.orderBy('order').toArray(), transactionsIn(month)]);
        const byId = new Map(categories.map((category) => [category.id, category]));
        const { entries, total } = monthSpending(txs, month, categories.map((category) => category.id));
        return {
          entries: entries.map(({ categoryId, ...entry }) => ({ category: categoryId === null ? null : byId.get(categoryId)!, ...entry })),
          total,
        };
      });
    },

    async netWorth(): Promise<NetWorthView> {
      return db.transaction('r', db.accounts, db.transactions, async () => {
        const [accounts, txs] = await Promise.all([db.accounts.toArray(), db.transactions.toArray()]);
        const first = txs.reduce<string | null>((oldest, tx) => (oldest === null || tx.date < oldest ? tx.date : oldest), null);
        const byAccount = new Map(accounts.map((account) => [account.id, [] as Transaction[]]));
        for (const tx of txs) {
          byAccount.get(tx.accountId)?.push(tx);
          if (tx.toAccountId) byAccount.get(tx.toAccountId)?.push(tx);
        }

        const date = today(now());
        const currentMonth = monthOf(date);
        const points: NetWorthPoint[] = [];
        // The last 12 months, the current one included.
        for (let back = 11; back >= 0; back--) {
          const month = addMonths(currentMonth, -back);
          if (first === null || month < monthOf(first)) continue;
          const end = back === 0 ? date : `${month}-${daysInMonth(month)}`;
          const balances = await Promise.all(
            accounts.map((account) => balanceOf(account, byAccount.get(account.id)!.filter((tx) => tx.date <= end))),
          );
          points.push({ month, date: end, netWorth: balances.reduce((sum, balance) => sum + balance, 0) });
        }
        const latest = points.at(-1)?.netWorth ?? null;
        const previous = points.at(-2)?.netWorth ?? null;
        return { points, latest, change: latest !== null && previous !== null ? latest - previous : null };
      });
    },

    async monthly(months): Promise<MonthlyView> {
      const currentMonth = monthOf(today(now()));
      return db.transaction('r', db.transactions, async () => {
        const [txs, first] = await Promise.all([
          db.transactions.where('date').between(`${addMonths(currentMonth, 1 - months)}-01`, `${addMonths(currentMonth, 1)}-01`).toArray(),
          // Balance adjustments aren't data: they only correct a balance.
          db.transactions.orderBy('date').filter((tx) => tx.source === 'import').first(),
        ]);
        return { entries: monthlySeries(txs, currentMonth, months, first ? monthOf(first.date) : null) };
      });
    },

    async budgets(month): Promise<BudgetsView> {
      return db.transaction('r', db.categories, db.budgetLimits, db.transactions, async () => {
        const [categories, limits, txs] = await Promise.all([db.categories.orderBy('order').toArray(), db.budgetLimits.toArray(), transactionsIn(month)]);
        const byId = new Map(categories.map((category) => [category.id, category]));
        const { budgets, totals, today: marker } = budgetMonth({
          month,
          categoryIds: categories.map((category) => category.id),
          limits,
          transactions: txs,
          today: today(now()),
        });
        return { budgets: budgets.map(({ categoryId, ...budget }) => ({ category: byId.get(categoryId)!, ...budget })), totals, today: marker };
      });
    },

    async budgetableCategories(month) {
      return db.transaction('r', db.categories, db.budgetLimits, async () => {
        const [categories, limits] = await Promise.all([db.categories.orderBy('order').toArray(), db.budgetLimits.toArray()]);
        return categories.filter((category) => category.kind === 'expense' && !category.archived && limitFor(limits, category.id, month) <= 0);
      });
    },

    async setBudgetLimit(categoryId, amount, fromMonth = monthOf(today(now()))) {
      checkWholeCents(amount, 'A budget limit');
      if (amount < 0) throw new Error(`A budget limit can't be negative: ${amount}`);
      checkMonth(fromMonth);
      await db.transaction('rw', db.categories, db.budgetLimits, async () => {
        const category = await db.categories.get(categoryId);
        if (!category) throw new Error(`Category ${categoryId} not found`);
        const limits = await limitsOf(categoryId).toArray();
        // A category made an income one after it got a budget can still have it removed.
        const removing = amount === 0 && limitFor(limits, categoryId, fromMonth) > 0;
        if (category.kind !== 'expense' && !removing) throw new Error(`Only expense categories can have a budget, not ${category.name}`);
        // "A partir de este mes": this month's limit is replaced and every later one goes.
        await db.budgetLimits.bulkDelete(limits.filter((limit) => limit.fromMonth > fromMonth).map((limit) => limit.id));
        const id = limits.find((limit) => limit.fromMonth === fromMonth)?.id ?? crypto.randomUUID();
        await db.budgetLimits.put({ id, categoryId, fromMonth, amount });
      });
      changed();
    },

    async listGoals(): Promise<GoalView[]> {
      const [accounts, goals] = await Promise.all([repository.listAccounts(), db.goals.toArray()]);
      const byId = new Map(accounts.map((account) => [account.id, account]));
      const currentMonth = monthOf(today(now()));
      return goals
        .flatMap((goal) => {
          const account = byId.get(goal.accountId);
          // Account deletion takes its goals along; this skips any left by an account deleted before it did.
          return account ? [{ ...goal, account, ...goalProgress(goal.target, account.balance, goal.targetMonth, currentMonth) }] : [];
        })
        .sort((a, b) => a.account.order - b.account.order || Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'es'));
    },

    async goalAccounts(goalId) {
      const [accounts, goals] = await Promise.all([repository.listAccounts(), db.goals.toArray()]);
      const ownAccountId = goals.find((goal) => goal.id === goalId)?.accountId;
      const taken = new Set(goals.filter((goal) => goal.id !== goalId && !goal.archived).map((goal) => goal.accountId));
      return accounts.filter((account) => account.id === ownAccountId || (!account.archived && !taken.has(account.id)));
    },

    async createGoal(draft: GoalDraft): Promise<GoalSaveResult> {
      const id = crypto.randomUUID();
      const name = tidyName(draft.name);
      const targetMonth = draft.targetMonth ?? null;
      checkGoalTarget(draft.target);
      if (targetMonth !== null) checkMonth(targetMonth);
      const result = await db.transaction('rw', db.accounts, db.goals, async (): Promise<GoalSaveResult> => {
        await checkGoalAccount(draft.accountId, null);
        if (name === '') return { ok: false, reason: 'empty' };
        const refused = await refuseGoalAccount(draft.accountId, id);
        if (refused) return refused;
        const { target, accountId, icon, color } = draft;
        await db.goals.add({ id, name, target, targetMonth, accountId, icon, color, archived: false });
        return { ok: true, id };
      });
      if (result.ok) changed();
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
      if (targetMonth !== undefined && targetMonth !== null) checkMonth(targetMonth);
      const result = await db.transaction('rw', db.accounts, db.goals, async (): Promise<GoalSaveResult> => {
        const goal = await db.goals.get(id);
        if (!goal) throw new Error(`Goal ${id} not found`);
        if (accountId !== undefined) await checkGoalAccount(accountId, goal.accountId);
        if (update.name === '') return { ok: false, reason: 'empty' };
        // An archived goal counts nothing twice: it's checked when unarchived.
        if (accountId !== undefined && accountId !== goal.accountId && !goal.archived) {
          const refused = await refuseGoalAccount(accountId, id);
          if (refused) return refused;
        }
        await db.goals.update(id, update);
        return { ok: true, id };
      });
      if (result.ok) changed();
      return result;
    },

    async setGoalArchived(id, archived): Promise<GoalSaveResult> {
      const result = await db.transaction('rw', db.goals, async (): Promise<GoalSaveResult> => {
        const goal = await db.goals.get(id);
        if (!goal) throw new Error(`Goal ${id} not found`);
        const refused = archived ? null : await refuseGoalAccount(goal.accountId, id);
        if (refused) return refused;
        await db.goals.update(id, { archived });
        return { ok: true, id };
      });
      if (result.ok) changed();
      return result;
    },

    async deleteGoal(id) {
      await db.transaction('rw', db.goals, async () => {
        if (!(await db.goals.get(id))) throw new Error(`Goal ${id} not found`);
        await db.goals.delete(id);
      });
      changed();
    },

    async subscriptions(): Promise<SubscriptionsView> {
      return db.transaction('r', db.categories, db.transactions, db.payees, async () => {
        // The category whose payees are the subscriptions, by name: it survives being recreated or seeded again.
        const category = await db.categories.filter((c) => normalizeText(c.name) === 'suscripciones').first();
        if (!category) return { subscriptions: [], totals: subscriptionTotals([]) };
        const date = today(now());
        const [charges, recent] = await Promise.all([
          db.transactions.where('categoryId').equals(category.id).toArray(),
          // Missing charges look at the two months before this one, whatever their category.
          db.transactions.where('date').between(`${addMonths(monthOf(date), -2)}-01`, `${addMonths(monthOf(date), 1)}-01`).toArray(),
        ]);
        const list = subscriptions([...new Map([...charges, ...recent].map((tx) => [tx.id, tx])).values()], category.id, date);
        const payees = await db.payees.bulkGet(list.map((subscription) => subscription.payeeId));
        return {
          subscriptions: list
            .map((subscription, i) => ({ ...subscription, payee: payees[i]! }))
            .sort((a, b) => a.payee.name.localeCompare(b.payee.name, 'es-ES')),
          totals: subscriptionTotals(list),
        };
      });
    },
  };

  return repository;
}
