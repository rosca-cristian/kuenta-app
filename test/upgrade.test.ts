import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import { STARTER_DATA_VERSION } from '../src/data/seed';
import type { Account, Category, Payee, Rule, Transaction } from '../src/domain/model';
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
  // Made before a category could count late incomes in the next month: version 5 sets it off.
  const categories: Omit<Category, 'nextMonthFromDay'>[] = [...PART_ONE_CATEGORIES, ...extraCategories].map(([name, kind], order) => ({
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

/** `categorizedByHand`: the user categorized every Part 1 transaction by hand. */
async function createPartOneDatabase(
  options: { onboardingDone?: boolean; extraCategories?: [string, Category['kind']][]; categorizedByHand?: boolean } = {},
) {
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
  if (options.categorizedByHand) {
    data.transactions = data.transactions.map((tx) => ({ ...tx, categoryId: tx.categoryId ?? 'cat-0', editedAt: stamp }));
  }
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
    for (const category of data.categories) expect(categories).toContainEqual({ ...category, nextMonthFromDay: null });

    const txs = [...(await repo.listTransactions('2026-09')), ...(await repo.listTransactions('2026-10'))];
    expect(txs.map((tx) => tx.id).sort()).toEqual(['tx-1', 'tx-2', 'tx-3']);
    for (const original of data.transactions) {
      const view = txs.find((tx) => tx.id === original.id)!;
      expect(view).toMatchObject(original);
      expect(view.payee).toEqual(data.payees.find((p) => p.id === original.payeeId));
    }
    expect(await repo.listImports()).toHaveLength(1);
    expect(await repo.getSettings()).toEqual({ onboardingDone: true, importAccountId: data.account.id, persistRequested: true, privacyMode: false });
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

describe('the offer to apply the starter rules to what was already imported', () => {
  const categoryOf = async (repo: ReturnType<typeof open>, id: string, month: string) =>
    (await repo.listTransactions(month)).find((tx) => tx.id === id)!.category?.name ?? null;

  it('counts the never-edited transactions the starter rules would change', async () => {
    const { name } = await createPartOneDatabase();
    // Two Mercadona purchases; the edited bar transaction doesn't count.
    expect(await open(name).starterRulesOffer()).toBe(2);
  });

  it('applies the rules when accepted, says how many changed, and is gone for good', async () => {
    const { name } = await createPartOneDatabase();
    const repo = open(name);
    // Inicio counts the month shown: one Mercadona purchase in each.
    const uncategorized = async () => (await repo.home('2026-09')).uncategorized + (await repo.home('2026-10')).uncategorized;
    expect(await uncategorized()).toBe(2);

    expect(await repo.acceptStarterRulesOffer()).toBe(2);
    expect(await categoryOf(repo, 'tx-1', '2026-09')).toBe('Supermercado');
    expect(await categoryOf(repo, 'tx-3', '2026-10')).toBe('Supermercado');
    expect(await categoryOf(repo, 'tx-2', '2026-09')).toBe('Restaurantes');
    expect(await uncategorized()).toBe(0);
    expect(await repo.starterRulesOffer()).toBeNull();
    expect(await open(name).starterRulesOffer()).toBeNull();
  });

  it('counts and applies the transfer rules the user made before accepting', async () => {
    const { name } = await createPartOneDatabase();
    const repo = open(name);
    const { id: revolutId } = (await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string };
    // The user's rule goes first, so it wins over the starter Mercadona rule.
    await repo.createRule({ name: 'Mercadona', match: { value: 'mercadona' }, actions: { transferAccountId: revolutId } });

    expect(await repo.starterRulesOffer()).toBe(2);
    expect(await repo.acceptStarterRulesOffer()).toBe(2);
    const october = await repo.listTransactions('2026-10');
    expect(october.find((tx) => tx.id === 'tx-3')).toMatchObject({ type: 'transfer', accountId: 'acc-bbva', toAccountId: revolutId, editedAt: null });
    expect((await repo.listAccounts()).find((account) => account.id === revolutId)!.balance).toBe(5000);
    expect((await repo.balanceCheck())?.difference).toBe(0);
  });

  it('changes nothing when dismissed, and is gone for good', async () => {
    const { name } = await createPartOneDatabase();
    const repo = open(name);
    await repo.dismissStarterRulesOffer();
    expect(await repo.starterRulesOffer()).toBeNull();
    expect(await categoryOf(repo, 'tx-1', '2026-09')).toBeNull();
    expect(await open(name).starterRulesOffer()).toBeNull();
  });

  it('is not made when the starter rules would change nothing', async () => {
    const { name } = await createPartOneDatabase();
    const repo = open(name);
    for (const id of ['tx-1', 'tx-3']) await repo.updateTransaction(id, { note: 'compra' });
    expect(await repo.starterRulesOffer()).toBeNull();
  });

  it('is not made when the update found nothing to change, even if a later rule would', async () => {
    const { name } = await createPartOneDatabase({ categorizedByHand: true });
    const repo = open(name);
    const result = await repo.previewImport(
      await bbvaXlsx([{ valor: '15/10/2026', concepto: 'Kfc', importe: -9 }], { startBalance: 910 }),
      'movimientos.xlsx',
    );
    if (!result.ok) throw new Error(result.error.message);
    await repo.commitImport(result.preview);
    await repo.createRule({ name: 'Kfc', match: { value: 'kfc' }, actions: { categoryId: 'cat-1' } });
    expect(await repo.starterRulesOffer()).toBeNull();
  });

  it('is not made on a first run, which imports with the rules already', async () => {
    const repo = createDexieRepository({ name: `kuenta-upgrade-${++dbCount}`, now: () => new Date('2026-10-20T10:00:00') });
    await repo.completeOnboarding({ importAccountName: 'BBVA' });
    const result = await repo.previewImport(await bbvaXlsx([{ valor: '01/10/2026', concepto: 'Kfc', importe: -9 }]), 'movimientos.xlsx');
    if (!result.ok) throw new Error(result.error.message);
    await repo.commitImport(result.preview);
    const restaurants = (await repo.listCategories()).find((c) => c.name === 'Restaurantes')!;
    await repo.createRule({ name: 'Kfc', match: { value: 'kfc' }, actions: { categoryId: restaurants.id } });
    expect(await repo.starterRulesOffer()).toBeNull();
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

/**
 * An install made by Parts 2 and 3: schema version 2, with rules, the starter data up to
 * date, a Revolut account and a top-up made a transfer to it.
 */
async function createPartThreeDatabase() {
  const name = `kuenta-upgrade-${++dbCount}`;
  const data = partOneData();
  const revolut: Account = { ...data.account, id: 'acc-revolut', name: 'Revolut', openingBalance: 0, order: 1 };
  const topUp: Transaction = {
    ...data.transactions[2], id: 'tx-4', type: 'transfer', amount: 5000, date: '2026-10-02', toAccountId: revolut.id, payeeId: null,
    importHash: 'hash-tx-4', bookingDate: '2026-10-02', bankConcept: 'Revolut**5625*', bankBalance: 86000,
  };
  const rule: Rule = {
    id: 'rule-revolut', name: 'Revolut', order: 0, enabled: true,
    match: { field: 'conceptOrMovement', op: 'contains', value: 'revolut', direction: 'any' }, actions: { transferAccountId: revolut.id },
  };
  const db = new Dexie(name);
  db.version(1).stores({
    accounts: 'id, order',
    categories: 'id, kind, order',
    payees: 'id, &normalized',
    transactions: 'id, date, [accountId+date], [toAccountId+date], categoryId, payeeId, &importHash, importBatchId, bookingDate',
    importBatches: 'id, importedAt',
    settings: 'key',
  });
  db.version(2).stores({ rules: 'id, order' });
  await db.table('accounts').bulkAdd([data.account, revolut]);
  await db.table('categories').bulkAdd(data.categories);
  await db.table('payees').bulkAdd(data.payees);
  await db.table('transactions').bulkAdd([...data.transactions, topUp]);
  await db.table('rules').add(rule);
  await db.table('settings').bulkPut([
    { key: 'importAccountId', value: data.account.id },
    { key: 'onboardingDone', value: true },
    { key: 'starterDataVersion', value: STARTER_DATA_VERSION },
  ]);
  db.close();
  return { name, data: { ...data, revolut, topUp, rule } };
}

describe('updating a Part 3 install to the schema with budgets and goals', () => {
  it('keeps every account, category, rule and transaction, and starts with no budgets', async () => {
    const { name, data } = await createPartThreeDatabase();
    const repo = open(name);

    const accounts = await repo.listAccounts();
    expect(accounts.map((account) => [account.id, account.balance])).toEqual([
      ['acc-bbva', 86000],
      ['acc-revolut', 5000],
    ]);
    expect(await repo.listCategories()).toEqual(data.categories.map((category) => ({ ...category, nextMonthFromDay: null })));
    expect(await repo.listRules()).toEqual([data.rule]);
    const txs = [...(await repo.listTransactions('2026-09')), ...(await repo.listTransactions('2026-10'))];
    expect(txs).toHaveLength(4);
    for (const original of [...data.transactions, data.topUp]) expect(txs.find((tx) => tx.id === original.id)).toMatchObject(original);
    expect((await repo.budgets('2026-10')).budgets).toEqual([]);

    // The new table takes budgets, kept across startups.
    await repo.setBudgetLimit('cat-1', 30000);
    expect((await open(name).budgets('2026-10')).budgets).toMatchObject([{ category: { name: 'Restaurantes' }, limit: 30000, spent: 0 }]);
  });
});

/** An install made before reimbursements: schema version 3, with a dinner and a Bizum received for it. */
async function createSchemaThreeDatabase() {
  const name = `kuenta-upgrade-${++dbCount}`;
  const data = partOneData();
  const bizum: Transaction = {
    ...data.transactions[2], id: 'tx-4', type: 'income', amount: 2000, date: '2026-10-02', payeeId: null, note: 'Recibido: cena',
    importHash: 'hash-tx-4', bookingDate: '2026-10-02', bankConcept: 'Bizum', bankMovement: 'Recibido: cena', bankBalance: 93000,
  };
  const db = new Dexie(name);
  db.version(1).stores({
    accounts: 'id, order',
    categories: 'id, kind, order',
    payees: 'id, &normalized',
    transactions: 'id, date, [accountId+date], [toAccountId+date], categoryId, payeeId, &importHash, importBatchId, bookingDate',
    importBatches: 'id, importedAt',
    settings: 'key',
  });
  db.version(2).stores({ rules: 'id, order' });
  db.version(3).stores({ budgetLimits: 'id, [categoryId+fromMonth]', goals: 'id, accountId' });
  await db.table('accounts').add(data.account);
  await db.table('categories').bulkAdd(data.categories);
  await db.table('payees').bulkAdd(data.payees);
  await db.table('transactions').bulkAdd([...data.transactions, bizum]);
  await db.table('settings').bulkPut([
    { key: 'importAccountId', value: data.account.id },
    { key: 'onboardingDone', value: true },
    { key: 'starterDataVersion', value: STARTER_DATA_VERSION },
  ]);
  db.close();
  return { name, transactions: [...data.transactions, bizum] };
}

describe('updating an install to the schema with reimbursements', () => {
  it('starts with none, and no transaction changes', async () => {
    const { name, transactions } = await createSchemaThreeDatabase();
    const repo = open(name);

    const txs = await repo.listTransactions(null);
    expect(txs).toHaveLength(4);
    for (const original of transactions) expect(txs.find((tx) => tx.id === original.id)).toEqual(expect.objectContaining({ ...original, reimbursement: null }));
    expect((await repo.home('2026-10')).summary).toMatchObject({ income: 2000, expenses: 3000 });

    // The new table takes links, kept across startups.
    await repo.setReimbursements('tx-4', [{ expenseId: 'tx-3', amount: 2000 }]);
    expect((await open(name).home('2026-10')).summary).toMatchObject({ income: 0, expenses: 1000 });
  });
});
