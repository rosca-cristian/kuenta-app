import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { Account, Category, Payee, Transaction } from '../src/domain/model';
import { bbvaXlsx } from './support/bbvaXlsx';

/**
 * An install made by Part 1: schema version 1, no rules, the Part 1 starter
 * categories and September and October imported, mostly uncategorized.
 */
const PART_ONE_CATEGORIES: [string, Category['kind']][] = [
  ['Supermercado', 'expense'], ['Restaurantes', 'expense'], ['Transporte', 'expense'], ['Vivienda', 'expense'],
  ['Suministros', 'expense'], ['Salud', 'expense'], ['Ocio', 'expense'], ['Compras', 'expense'],
  ['Suscripciones', 'expense'], ['Viajes', 'expense'], ['Educación', 'expense'], ['Regalos', 'expense'],
  ['Comisiones e impuestos', 'expense'], ['Efectivo', 'expense'], ['Otros gastos', 'expense'],
  ['Nómina', 'income'], ['Reembolsos', 'income'], ['Intereses', 'income'], ['Otros ingresos', 'income'],
];

const stamp = '2026-10-14T18:00:00.000Z';

function partOneData(extraCategories: [string, Category['kind']][] = []) {
  const account: Account = {
    id: 'acc-bbva', name: 'BBVA', type: 'bank', openingBalance: 100000, color: 'blue', icon: 'landmark',
    archived: false, order: 0, createdAt: stamp, updatedAt: stamp,
  };
  const categories: Category[] = [...PART_ONE_CATEGORIES, ...extraCategories].map(([name, kind], order) => ({
    id: `cat-${order}`, name, kind, icon: 'ellipsis', color: 'gray', order, archived: false,
  }));
  const payees: Payee[] = [
    { id: 'pay-mercadona', name: 'Mercadona', normalized: 'mercadona' },
    { id: 'pay-bar', name: 'Bar Ejemplo', normalized: 'bar ejemplo' },
  ];
  let balance = 100000;
  const tx = (id: string, date: string, concept: string, amount: number, extra: Partial<Transaction> = {}): Transaction => {
    balance += amount;
    return {
      id, type: amount < 0 ? 'expense' : 'income', amount: Math.abs(amount), date, accountId: account.id, toAccountId: null,
      categoryId: null, payeeId: null, note: '', source: 'import', importBatchId: 'batch-1', importHash: `hash-${id}`,
      bookingDate: date, bankConcept: concept, bankMovement: 'Pago con tarjeta', bankBalance: balance, editedAt: null,
      createdAt: stamp, updatedAt: stamp, ...extra,
    };
  };
  const transactions = [
    tx('tx-1', '2026-09-02', 'Mercadona', -2000, { payeeId: 'pay-mercadona' }),
    tx('tx-2', '2026-09-15', 'Bar ejemplo', -4000, { payeeId: 'pay-bar', categoryId: 'cat-1', editedAt: stamp }),
    tx('tx-3', '2026-10-01', 'Mercadona', -3000, { payeeId: 'pay-mercadona' }),
  ];
  return { account, categories, payees, transactions };
}

let dbCount = 0;

async function createPartOneDatabase(options: { onboardingDone?: boolean; extraCategories?: [string, Category['kind']][] } = {}) {
  const name = `kuenta-upgrade-${++dbCount}`;
  const data = partOneData(options.extraCategories);
  const db = new Dexie(name);
  db.version(1).stores({
    accounts: 'id, order',
    categories: 'id, kind, order',
    payees: 'id, &normalized',
    transactions: 'id, date, [accountId+date], [toAccountId+date], categoryId, payeeId, &importHash, importBatchId, bookingDate',
    importBatches: 'id, importedAt',
    settings: 'key',
  });
  await db.table('accounts').add(data.account);
  await db.table('categories').bulkAdd(data.categories);
  await db.table('payees').bulkAdd(data.payees);
  await db.table('transactions').bulkAdd(data.transactions);
  await db.table('importBatches').add({
    id: 'batch-1', importedAt: stamp, fileName: 'movimientos.xlsx', accountId: data.account.id, dateFrom: '2026-09-02',
    dateTo: '2026-10-01', rows: 3, created: 3, skipped: 0, bankBalance: 91000, appBalance: 91000, undone: false,
  });
  await db.table('settings').bulkPut([
    { key: 'importAccountId', value: data.account.id },
    { key: 'onboardingDone', value: options.onboardingDone ?? true },
    { key: 'persistRequested', value: true },
  ]);
  db.close();
  return { name, data };
}

const open = (name: string) => createDexieRepository({ name, now: () => new Date('2026-10-20T10:00:00') });

describe('updating a Part 1 install', () => {
  it('keeps every account, category, payee and transaction', async () => {
    const { name, data } = await createPartOneDatabase();
    const repo = open(name);

    const [account] = await repo.listAccounts();
    expect(account).toMatchObject({ ...data.account, balance: 91000, isImportAccount: true });
    const categories = await repo.listCategories();
    for (const category of data.categories) expect(categories).toContainEqual(category);

    const txs = [...(await repo.listTransactions('2026-09')), ...(await repo.listTransactions('2026-10'))];
    expect(txs.map((tx) => tx.id).sort()).toEqual(['tx-1', 'tx-2', 'tx-3']);
    for (const original of data.transactions) {
      const view = txs.find((tx) => tx.id === original.id)!;
      expect(view).toMatchObject(original);
      expect(view.payee).toEqual(data.payees.find((p) => p.id === original.payeeId));
    }
    expect(await repo.listImports()).toHaveLength(1);
    expect(await repo.getSettings()).toEqual({ onboardingDone: true, importAccountId: data.account.id, persistRequested: true });
  });

  it('adds the new starter categories and the starter rules, once', async () => {
    const { name } = await createPartOneDatabase();
    const first = open(name);
    const categories = await first.listCategories();
    expect(categories).toHaveLength(21);
    expect(categories.find((c) => c.name === 'Prestaciones')).toMatchObject({ kind: 'income' });
    expect(categories.find((c) => c.name === 'Préstamos')).toMatchObject({ kind: 'expense' });
    const rules = await first.listRules();
    expect(rules).toHaveLength(17);
    expect(rules.find((rule) => rule.name === 'Mercadona')!.actions.categoryId).toBe('cat-0');

    // The next startup finds the starter data up to date.
    const second = open(name);
    expect(await second.listCategories()).toHaveLength(21);
    expect(await second.listRules()).toHaveLength(17);
  });

  it('adds the starter data once when two tabs start at the same time', async () => {
    const { name } = await createPartOneDatabase();
    const [a, b] = [open(name), open(name)];
    await Promise.all([a.listRules(), b.listRules()]);
    expect(await a.listRules()).toHaveLength(17);
    expect(await b.listCategories()).toHaveLength(21);
  });

  it('matches starter categories by normalized name, never duplicating one', async () => {
    const { name } = await createPartOneDatabase({ extraCategories: [['PRESTACIONES', 'income']] });
    const repo = open(name);
    const names = (await repo.listCategories()).map((c) => c.name);
    expect(names.filter((n) => n.toLowerCase() === 'prestaciones')).toEqual(['PRESTACIONES']);
    expect(names).toContain('Préstamos');
  });

  it('leaves the imported transactions as they were, and applies the rules to the next import', async () => {
    const { name } = await createPartOneDatabase();
    const repo = open(name);
    expect((await repo.listTransactions('2026-09')).find((tx) => tx.id === 'tx-1')!.categoryId).toBeNull();

    const result = await repo.previewImport(
      await bbvaXlsx([{ valor: '15/10/2026', concepto: 'Mercadona', importe: -15 }], { startBalance: 910 }),
      'movimientos.xlsx',
    );
    if (!result.ok) throw new Error(result.error.message);
    await repo.commitImport(result.preview);
    const october = await repo.listTransactions('2026-10');
    expect(october.find((tx) => tx.date === '2026-10-15')!.category?.name).toBe('Supermercado');
    expect(october.find((tx) => tx.id === 'tx-3')!.categoryId).toBeNull();
  });

  it('adds nothing to an install that never finished the first run, which seeds it instead', async () => {
    const { name } = await createPartOneDatabase({ onboardingDone: false });
    const repo = open(name);
    expect(await repo.listRules()).toHaveLength(0);
  });
});

describe('a starter data upgrade already done', () => {
  it('does not bring back a starter rule the user changed', async () => {
    const { name } = await createPartOneDatabase();
    const repo = open(name);
    const mercadona = (await repo.listRules()).find((rule) => rule.name === 'Mercadona')!;
    await repo.updateRule(mercadona.id, { enabled: false });
    const again = open(name);
    const rules = await again.listRules();
    expect(rules.filter((rule) => rule.name === 'Mercadona')).toEqual([{ ...mercadona, enabled: false }]);
  });
});
