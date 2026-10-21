import { KuentaDb } from './db';
import { STARTER_CATEGORIES, STARTER_DATA_VERSION, STARTER_RULES } from '../seed';
import { bankOrder, findGaps, latestBalanceOf, openingBalanceOf, type ChainLink } from '../../domain/chain';
import { planImport, reapplyRules } from '../../domain/importPlan';
import { applyRules as firstMatchActions, hasAction, ruleMatches, suggestedRuleText } from '../../domain/rules';
import { monthSummary } from '../../domain/stats';
import { addMonths, daysBetween, today } from '../../domain/dates';
import { normalizeText } from '../../domain/text';
import {
  signedAmount,
  type Account,
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
  CategoryChanges,
  CategoryDraft,
  CategorySaveResult,
  CategoryUsage,
  CommitImportOptions,
  DataRepository,
  HomeData,
  ImportOutcome,
  ImportPreview,
  PayeeRenameResult,
  PayeeView,
  PreviewResult,
  RuleChanges,
  RuleDraft,
  Settings,
  TransactionChanges,
  TransactionView,
} from '../repository';

export interface DexieRepositoryOptions {
  /** IndexedDB database name. */
  name?: string;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

type Link = ChainLink & { tx: Transaction };

/** What applying rules changes on one transaction. */
type RuleChange = { id: Id; categoryId?: Id; payeeName?: string };

/** A payee name as stored: single spaces, no leading or trailing ones. */
const tidyName = (name: string) => name.replace(/\s+/g, ' ').trim();

/** A rule's actions as stored: a blank payee name is no action. */
function tidyActions(actions: RuleActions): RuleActions {
  const tidy: RuleActions = {};
  if (actions.categoryId !== undefined) tidy.categoryId = actions.categoryId;
  const payeeName = tidyName(actions.payeeName ?? '');
  if (payeeName !== '') tidy.payeeName = payeeName;
  return tidy;
}

/**
 * Throws unless the rule can be saved: it needs a text, and an action unless it's disabled
 * (deleting a category can leave a disabled rule without one, to be repointed).
 */
function checkRule(rule: Rule) {
  if (normalizeText(rule.match.value) === '') throw new Error('A rule needs a text to match');
  if (rule.enabled && !hasAction(rule.actions)) throw new Error('An enabled rule needs a category or a payee name');
}

/**
 * Setting for Inicio's offer to apply the starter rules to the transactions imported
 * before an update brought them: 'pending' until accepted or dismissed, then 'done'.
 * Absent when no update brought them (e.g. a first run).
 */
const STARTER_RULES_OFFER = 'starterRulesOffer';
type StarterRulesOffer = 'pending' | 'done';

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
   * What the rules (first enabled match wins, by order) would change on the imported
   * transactions the user never edited: only what differs from what they have.
   */
  async function ruleChanges(rules: Rule[]): Promise<RuleChange[]> {
    const [txs, payees] = await Promise.all([
      db.transactions.filter((tx) => tx.source === 'import' && tx.type !== 'transfer' && tx.editedAt === null).toArray(),
      db.payees.toArray(),
    ]);
    const payeeNames = new Map(payees.map((payee) => [payee.id, payee.normalized]));
    const changes: RuleChange[] = [];
    for (const tx of txs) {
      const actions = firstMatchActions(rules, {
        concept: tx.bankConcept ?? '',
        movement: tx.bankMovement ?? '',
        amount: signedAmount(tx, tx.accountId),
      });
      if (!actions) continue;
      const change: RuleChange = { id: tx.id };
      if (actions.categoryId !== undefined && actions.categoryId !== tx.categoryId) change.categoryId = actions.categoryId;
      const payeeName = tidyName(actions.payeeName ?? '');
      if (payeeName !== '' && normalizeText(payeeName) !== (tx.payeeId && payeeNames.get(tx.payeeId))) change.payeeName = payeeName;
      if (change.categoryId !== undefined || change.payeeName !== undefined) changes.push(change);
    }
    return changes;
  }

  /**
   * Applies the rules to the transactions the user never edited, leaving them never
   * edited. Returns how many changed. Call it inside a transaction on rules, transactions and payees.
   */
  async function applyToNeverEdited(rules: Rule[]): Promise<number> {
    const changes = await ruleChanges(rules);
    for (const change of changes) {
      const update: Partial<Transaction> = { updatedAt: stamp() };
      if (change.categoryId !== undefined) update.categoryId = change.categoryId;
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

  function checkOpeningBalance(cents: number) {
    if (!Number.isSafeInteger(cents)) throw new Error(`An opening balance must be whole cents, not ${cents}`);
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

  const newestFirst = (a: Transaction, b: Transaction) =>
    b.date.localeCompare(a.date) || (b.bookingDate ?? '').localeCompare(a.bookingDate ?? '') || b.createdAt.localeCompare(a.createdAt);

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
        accounts.map(async (account) => ({
          ...account,
          balance: await balanceOf(account, await accountTransactions(account.id)),
          isImportAccount: account.id === importId,
        })),
      );
    },

    async createAccount(draft: AccountDraft): Promise<AccountSaveResult> {
      const id = crypto.randomUUID();
      const name = tidyName(draft.name);
      const openingBalance = draft.openingBalance ?? 0;
      checkOpeningBalance(openingBalance);
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
        checkOpeningBalance(update.openingBalance);
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

    async listCategories() {
      return db.categories.orderBy('order').filter((category) => !category.archived).toArray();
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
      const [transactions, rules] = await Promise.all([
        db.transactions.where('categoryId').equals(id).count(),
        db.rules.filter((rule) => rule.actions.categoryId === id).count(),
      ]);
      return { transactions, rules };
    },

    async deleteCategory(id, moveTo) {
      await db.transaction('rw', db.categories, db.transactions, db.rules, async () => {
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
        await db.categories.delete(id);
      });
      changed();
    },

    async listRules() {
      return db.rules.orderBy('order').toArray();
    },

    async createRule(draft: RuleDraft) {
      const id = crypto.randomUUID();
      await db.transaction('rw', db.rules, async () => {
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
        checkRule({ ...rule, enabled: true });
        await db.rules.add(rule);
      });
      changed();
      return id;
    },

    async updateRule(id, changes: RuleChanges) {
      await db.transaction('rw', db.rules, async () => {
        const rule = await db.rules.get(id);
        if (!rule) throw new Error(`Rule ${id} not found`);
        const updated: Rule = {
          ...rule,
          ...changes,
          match: { ...rule.match, ...changes.match },
          actions: tidyActions(changes.actions ?? rule.actions),
        };
        checkRule(updated);
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
      return db.transaction('r', db.transactions, db.payees, async () => {
        const imported = await db.transactions.filter((tx) => tx.source === 'import' && tx.type !== 'transfer').toArray();
        const matching = imported.filter((tx) =>
          ruleMatches(rule.match, { concept: tx.bankConcept ?? '', movement: tx.bankMovement ?? '', amount: signedAmount(tx, tx.accountId) }),
        ).length;
        return { matching, applicable: (await ruleChanges([rule])).length };
      });
    },

    async applyRules(ruleId) {
      const count = await db.transaction('rw', db.rules, db.transactions, db.payees, async () => {
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

    async listTransactions(month) {
      const txs = await db.transactions.where('date').between(`${month}-01`, `${month}-31￿`).toArray();
      return toViews(txs.sort(newestFirst));
    },

    async getTransaction(id) {
      const tx = await db.transactions.get(id);
      return tx ? (await toViews([tx]))[0] : null;
    },

    async updateTransaction(id, changes: TransactionChanges) {
      await db.transaction('rw', db.transactions, db.payees, async () => {
        const tx = await db.transactions.get(id);
        if (!tx) throw new Error(`Transaction ${id} not found`);
        const update: Partial<Transaction> = { updatedAt: stamp(), editedAt: stamp() };
        if (changes.categoryId !== undefined) update.categoryId = tx.type === 'transfer' ? null : changes.categoryId;
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
        const txs: Transaction[] = [];
        for (const row of fresh) {
          txs.push({
            id: crypto.randomUUID(),
            type: row.type,
            amount: row.amount,
            date: row.date,
            accountId: preview.accountId,
            toAccountId: null,
            // A category chosen in the preview is the user's edit; one set by a rule isn't.
            categoryId: chosen.has(row.hash) ? (chosen.get(row.hash) ?? null) : row.categoryId,
            payeeId: await payeeIdFor(row.payeeName),
            note: row.note,
            source: 'import',
            importBatchId: batchId,
            importHash: row.hash,
            bookingDate: row.bookingDate,
            bankConcept: row.concept,
            bankMovement: row.movement,
            bankBalance: row.bankBalance,
            editedAt: chosen.has(row.hash) ? importedAt : null,
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
      const accountId = await importAccountId();
      const createdAt = stamp();
      await db.transactions.add({
        id: crypto.randomUUID(),
        type: check.difference > 0 ? 'income' : 'expense',
        amount: Math.abs(check.difference),
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
      const [monthTxs, lastImport, uncategorized, chain] = await Promise.all([
        db.transactions.where('date').between(`${month}-01`, `${addMonths(month, 1)}-01`).toArray(),
        db.importBatches.orderBy('importedAt').reverse().filter((batch) => !batch.undone).first(),
        db.transactions.filter((tx) => tx.source === 'import' && tx.type !== 'transfer' && tx.categoryId === null).count(),
        chainOf(accountId),
      ]);
      return {
        // Archived accounts still hold money: they count in the total, but aren't listed.
        totalBalance: allAccounts.reduce((sum, account) => sum + account.balance, 0),
        summary: monthSummary(monthTxs, month),
        accounts: allAccounts.filter((account) => !account.archived),
        daysSinceLastImport: lastImport ? daysBetween(today(new Date(lastImport.importedAt)), today(now())) : null,
        uncategorized,
        gaps: findGaps(chain),
      };
    },
  };

  return repository;
}
