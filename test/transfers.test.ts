import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import { KuentaDb } from '../src/data/dexie/db';
import type { DataRepository, TransactionView } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

/** A repository whose clock the test can move, to see the edited marker change. */
async function setup() {
  const name = `kuenta-transfers-test-${++dbCount}`;
  const clock = { now: new Date('2026-10-20T10:00:00') };
  const repo = createDexieRepository({ name, now: () => clock.now });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  const { id: revolutId } = (await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string };
  return { repo, name, clock, revolutId };
}

async function importFile(repo: DataRepository, movements: SampleMovement[], startBalance = 1000) {
  const result = await repo.previewImport(await bbvaXlsx(movements, { startBalance }), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return repo.commitImport(result.preview);
}

async function balances(repo: DataRepository) {
  return Object.fromEntries((await repo.listAccounts()).map((account) => [account.name, account.balance]));
}

async function transactionNamed(repo: DataRepository, concept: string, month = '2026-10'): Promise<TransactionView> {
  const tx = (await repo.listTransactions(month)).find((t) => t.bankConcept === concept);
  if (!tx) throw new Error(`No transaction ${concept}`);
  return tx;
}

const october: SampleMovement[] = [
  { valor: '01/10/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
  { valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -50 },
  { valor: '05/10/2026', concepto: 'Revolut**5625*', movimiento: 'Pago con tarjeta', importe: -200 },
  { valor: '08/10/2026', concepto: 'Transferencia recibida', movimiento: 'Desde Revolut', importe: 80 },
];

describe('converting an imported transaction into a transfer', () => {
  it('turns an expense into an outgoing transfer to the chosen account, out of the month and into its balance', async () => {
    const { repo, clock, revolutId } = await setup();
    await importFile(repo, october);
    const topUp = await transactionNamed(repo, 'Revolut**5625*');
    await repo.updateTransaction(topUp.id, { categoryId: (await repo.listCategories())[0].id, payeeName: 'Revolut', note: 'Recarga' });
    const before = await repo.home('2026-10');
    expect(await balances(repo)).toEqual({ BBVA: 233000, Revolut: 0 });

    clock.now = new Date('2026-10-21T09:00:00');
    await repo.updateTransaction(topUp.id, { transferAccountId: revolutId });

    const bbva = (await repo.listAccounts())[0];
    expect(await repo.getTransaction(topUp.id)).toMatchObject({
      type: 'transfer',
      amount: 20000,
      accountId: bbva.id,
      toAccountId: revolutId,
      account: { name: 'BBVA' },
      toAccount: { name: 'Revolut' },
      categoryId: null,
      payee: { name: 'Revolut' },
      note: 'Recarga',
      editedAt: clock.now.toISOString(),
    });
    expect(await balances(repo)).toEqual({ BBVA: 233000, Revolut: 20000 });
    const { summary } = await repo.home('2026-10');
    expect(summary.expenses).toBe(before.summary.expenses - 20000);
    expect(summary.income).toBe(before.summary.income);
    expect(await repo.balanceCheck()).toEqual({ bankBalance: 233000, appBalance: 233000, difference: 0 });
  });

  it("leaves Inicio's total balance as it was before the money moved", async () => {
    const { repo, revolutId } = await setup();
    await importFile(repo, october.slice(0, 2), 1000);
    const before = (await repo.home('2026-10')).totalBalance;
    await importFile(repo, [october[2]], 2450);

    await repo.updateTransaction((await transactionNamed(repo, 'Revolut**5625*')).id, { transferAccountId: revolutId });

    // The 200 € left BBVA and reached Revolut: the user is no richer or poorer.
    const home = await repo.home('2026-10');
    expect(home.accounts.map((a) => [a.name, a.balance])).toEqual([
      ['BBVA', 225000],
      ['Revolut', 20000],
    ]);
    expect(home.totalBalance).toBe(before);
  });

  it('turns an income into an incoming transfer from the chosen account, whose balance goes down', async () => {
    const { repo, revolutId } = await setup();
    await importFile(repo, october);
    const comeBack = await transactionNamed(repo, 'Transferencia recibida');
    const before = (await repo.home('2026-10')).summary;

    await repo.updateTransaction(comeBack.id, { transferAccountId: revolutId });

    const bbva = (await repo.listAccounts())[0];
    expect(await repo.getTransaction(comeBack.id)).toMatchObject({
      type: 'transfer',
      amount: 8000,
      accountId: revolutId,
      toAccountId: bbva.id,
      categoryId: null,
    });
    expect(await balances(repo)).toEqual({ BBVA: 233000, Revolut: -8000 });
    expect((await repo.home('2026-10')).summary.income).toBe(before.income - 8000);
    expect((await repo.balanceCheck())?.difference).toBe(0);
  });

  it('can move a transfer to another account', async () => {
    const { repo, revolutId } = await setup();
    const { id: savingsId } = (await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'pink' })) as { id: string };
    await importFile(repo, october);
    const topUp = await transactionNamed(repo, 'Revolut**5625*');
    await repo.updateTransaction(topUp.id, { transferAccountId: revolutId });

    await repo.updateTransaction(topUp.id, { transferAccountId: savingsId });

    expect(await repo.getTransaction(topUp.id)).toMatchObject({ type: 'transfer', toAccountId: savingsId });
    expect(await balances(repo)).toEqual({ BBVA: 233000, Revolut: 0, Hucha: 20000 });
  });

  it('keeps the transfer when a category arrives in the same change, and when rules are applied later', async () => {
    const { repo, revolutId } = await setup();
    await importFile(repo, october);
    const topUp = await transactionNamed(repo, 'Revolut**5625*');
    const category = (await repo.listCategories())[0];

    await repo.updateTransaction(topUp.id, { transferAccountId: revolutId, categoryId: category.id });
    await repo.createRule({ name: 'Revolut', match: { value: 'revolut' }, actions: { categoryId: category.id } });
    await repo.applyRules();

    expect(await repo.getTransaction(topUp.id)).toMatchObject({ type: 'transfer', toAccountId: revolutId, categoryId: null });
  });

  it("isn't counted as uncategorized", async () => {
    const { repo, revolutId } = await setup();
    await importFile(repo, october);
    const before = (await repo.home('2026-10')).uncategorized;

    await repo.updateTransaction((await transactionNamed(repo, 'Revolut**5625*')).id, { transferAccountId: revolutId });

    expect((await repo.home('2026-10')).uncategorized).toBe(before - 1);
  });
});

describe('refused conversions', () => {
  it("refuses the transaction's own account, an archived account, an unknown one and a balance adjustment, changing nothing", async () => {
    const { repo, name } = await setup();
    await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'pink' });
    const db = new KuentaDb(name);
    await db.accounts.filter((account) => account.name === 'Hucha').modify({ archived: true });
    db.close();
    // The file's balances don't chain, so Kuenta disagrees with the bank and a balance adjustment can be made.
    await importFile(repo, [
      { valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -50 },
      { valor: '03/10/2026', concepto: 'Lidl', movimiento: 'Pago con tarjeta', importe: -10, disponible: 900 },
    ]);
    await repo.createBalanceAdjustment();
    const [bbva, , hucha] = await repo.listAccounts();
    const expense = await transactionNamed(repo, 'Mercadona');
    const adjustment = (await repo.listTransactions('2026-10')).find((tx) => tx.source === 'adjustment')!;
    const before = await repo.listTransactions('2026-10');

    await expect(repo.updateTransaction(expense.id, { transferAccountId: bbva.id })).rejects.toThrow();
    await expect(repo.updateTransaction(expense.id, { transferAccountId: hucha.id })).rejects.toThrow();
    await expect(repo.updateTransaction(expense.id, { transferAccountId: 'nope' })).rejects.toThrow();
    const revolut = (await repo.listAccounts()).find((a) => a.name === 'Revolut')!;
    await expect(repo.updateTransaction(adjustment.id, { transferAccountId: revolut.id })).rejects.toThrow();

    expect(await repo.listTransactions('2026-10')).toEqual(before);
  });
});

describe('Quitar transferencia', () => {
  it('turns an outgoing transfer back into an uncategorized expense, keeping payee and note, and the balances return', async () => {
    const { repo, clock, revolutId } = await setup();
    await importFile(repo, october);
    const topUp = await transactionNamed(repo, 'Revolut**5625*');
    await repo.updateTransaction(topUp.id, { payeeName: 'Revolut', note: 'Recarga' });
    const before = await repo.home('2026-10');
    await repo.updateTransaction(topUp.id, { transferAccountId: revolutId });

    clock.now = new Date('2026-10-22T09:00:00');
    await repo.updateTransaction(topUp.id, { transferAccountId: null });

    expect(await repo.getTransaction(topUp.id)).toMatchObject({
      type: 'expense',
      amount: 20000,
      accountId: (await repo.listAccounts())[0].id,
      toAccountId: null,
      categoryId: null,
      payee: { name: 'Revolut' },
      note: 'Recarga',
      editedAt: clock.now.toISOString(),
    });
    expect(await balances(repo)).toEqual({ BBVA: 233000, Revolut: 0 });
    expect((await repo.home('2026-10')).summary).toEqual(before.summary);
    expect((await repo.balanceCheck())?.difference).toBe(0);
  });

  it('turns an incoming transfer back into an income, with the import account as its account', async () => {
    const { repo, revolutId } = await setup();
    await importFile(repo, october);
    const comeBack = await transactionNamed(repo, 'Transferencia recibida');
    await repo.updateTransaction(comeBack.id, { transferAccountId: revolutId });

    await repo.updateTransaction(comeBack.id, { transferAccountId: null });

    expect(await repo.getTransaction(comeBack.id)).toMatchObject({
      type: 'income',
      accountId: (await repo.listAccounts())[0].id,
      toAccountId: null,
      categoryId: null,
    });
    expect(await balances(repo)).toEqual({ BBVA: 233000, Revolut: 0 });
  });

  it('takes a category chosen in the same change', async () => {
    const { repo, revolutId } = await setup();
    await importFile(repo, october);
    const topUp = await transactionNamed(repo, 'Revolut**5625*');
    const category = (await repo.listCategories())[0];
    await repo.updateTransaction(topUp.id, { transferAccountId: revolutId });

    await repo.updateTransaction(topUp.id, { transferAccountId: null, categoryId: category.id });

    expect(await repo.getTransaction(topUp.id)).toMatchObject({ type: 'expense', categoryId: category.id });
  });

  it("changes nothing but the edit on a transaction that isn't a transfer", async () => {
    const { repo } = await setup();
    await importFile(repo, october);
    const groceries = await transactionNamed(repo, 'Mercadona');
    const category = (await repo.listCategories())[0];
    await repo.updateTransaction(groceries.id, { categoryId: category.id });

    await repo.updateTransaction(groceries.id, { transferAccountId: null });

    expect(await repo.getTransaction(groceries.id)).toMatchObject({ type: 'expense', categoryId: category.id, toAccountId: null });
  });
});

describe('the bank chain with transfers', () => {
  it('keeps gaps, the opening balance and the balance check as they were', async () => {
    const { repo, revolutId } = await setup();
    await importFile(repo, october.slice(0, 2), 1000);
    // A week is missing between the two files: 1000 + 1500 − 50 = 2450, but the next file starts at 2500.
    await importFile(repo, october.slice(2), 2500);
    const before = await repo.home('2026-10');
    const bbvaBefore = (await repo.listAccounts())[0];
    expect(before.gaps).toEqual([{ after: '2026-10-02', before: '2026-10-05' }]);

    await repo.updateTransaction((await transactionNamed(repo, 'Revolut**5625*')).id, { transferAccountId: revolutId });
    await repo.updateTransaction((await transactionNamed(repo, 'Transferencia recibida')).id, { transferAccountId: revolutId });

    expect((await repo.home('2026-10')).gaps).toEqual(before.gaps);
    expect((await repo.listAccounts())[0]).toMatchObject({ openingBalance: bbvaBefore.openingBalance, balance: bbvaBefore.balance });
    expect((await repo.balanceCheck())?.difference).toBe(5000);

    // An older import still moves the opening balance, with the transfers in the chain.
    await importFile(repo, [{ valor: '15/09/2026', concepto: 'Lidl', movimiento: 'Pago con tarjeta', importe: -10 }], 1010);
    expect((await repo.listAccounts())[0].openingBalance).toBe(101000);
  });

  it('undoing the import removes its transfers, and the other account follows', async () => {
    const { repo, revolutId } = await setup();
    const { batch } = await importFile(repo, october);
    await repo.updateTransaction((await transactionNamed(repo, 'Revolut**5625*')).id, { transferAccountId: revolutId });
    expect(await balances(repo)).toEqual({ BBVA: 233000, Revolut: 20000 });

    await repo.undoImport(batch.id);

    expect(await repo.listTransactions('2026-10')).toEqual([]);
    expect(await balances(repo)).toEqual({ BBVA: 0, Revolut: 0 });
    expect(await repo.balanceCheck()).toBeNull();
  });
});
