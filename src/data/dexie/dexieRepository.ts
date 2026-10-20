import { KuentaDb } from './db';
import { STARTER_CATEGORIES } from '../seed';
import { bankOrder, findGaps, latestBalanceOf, openingBalanceOf, type ChainLink } from '../../domain/chain';
import { planImport } from '../../domain/importPlan';
import { monthSummary } from '../../domain/stats';
import { addMonths, daysBetween, today } from '../../domain/dates';
import { normalizeText } from '../../domain/text';
import { signedAmount, type Account, type Id, type ImportBatch, type Transaction } from '../../domain/model';
import { readBbvaFile } from '../../import/bbva/reader';
import type {
  AccountView,
  BalanceCheck,
  DataRepository,
  HomeData,
  ImportOutcome,
  ImportPreview,
  PayeeRenameResult,
  PayeeView,
  PreviewResult,
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

/** A payee name as stored: single spaces, no leading or trailing ones. */
const tidyName = (name: string) => name.replace(/\s+/g, ' ').trim();

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
      await db.transaction('rw', db.accounts, db.categories, db.settings, async () => {
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
        if ((await db.categories.count()) === 0) {
          await db.categories.bulkAdd(
            STARTER_CATEGORIES.map((category, order) => ({ ...category, id: crypto.randomUUID(), order, archived: false })),
          );
        }
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

    async listCategories() {
      return db.categories.orderBy('order').filter((category) => !category.archived).toArray();
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
      const result = await db.transaction('rw', db.payees, async (): Promise<PayeeRenameResult> => {
        const existing = await db.payees.where('normalized').equals(normalized).first();
        if (existing && existing.id !== id) return { ok: false, reason: 'exists', existing };
        await db.payees.update(id, { name, normalized });
        return { ok: true };
      });
      if (result.ok) changed();
      return result;
    },

    async mergePayees(keepId, mergeIds) {
      const merged = mergeIds.filter((id) => id !== keepId);
      if (merged.length === 0) return;
      await db.transaction('rw', db.payees, db.transactions, async () => {
        if (!(await db.payees.get(keepId))) throw new Error(`Payee ${keepId} not found`);
        // Only the payee changes: category, note and the user's edited marker stay as they were.
        await db.transactions.where('payeeId').anyOf(merged).modify({ payeeId: keepId, updatedAt: stamp() });
        await db.payees.bulkDelete(merged);
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
      return { ok: true, preview: { fileName, accountId, plan: planImport(result.rows, existing) } };
    },

    async commitImport(preview: ImportPreview, { exclude = [] } = {}): Promise<ImportOutcome> {
      const excluded = new Set(exclude);
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
            categoryId: null,
            payeeId: await payeeIdFor(row.payeeName),
            note: row.note,
            source: 'import',
            importBatchId: batchId,
            importHash: row.hash,
            bookingDate: row.bookingDate,
            bankConcept: row.concept,
            bankMovement: row.movement,
            bankBalance: row.bankBalance,
            editedAt: null,
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
      const accounts = (await repository.listAccounts()).filter((account) => !account.archived);
      const accountId = await importAccountId();
      const [monthTxs, lastImport, uncategorized, chain] = await Promise.all([
        db.transactions.where('date').between(`${month}-01`, `${addMonths(month, 1)}-01`).toArray(),
        db.importBatches.orderBy('importedAt').reverse().filter((batch) => !batch.undone).first(),
        db.transactions.filter((tx) => tx.source === 'import' && tx.type !== 'transfer' && tx.categoryId === null).count(),
        chainOf(accountId),
      ]);
      return {
        totalBalance: accounts.reduce((sum, account) => sum + account.balance, 0),
        summary: monthSummary(monthTxs, month),
        accounts,
        daysSinceLastImport: lastImport ? daysBetween(today(new Date(lastImport.importedAt)), today(now())) : null,
        uncategorized,
        gaps: findGaps(chain),
      };
    },
  };

  return repository;
}
