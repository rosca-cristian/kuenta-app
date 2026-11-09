import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import { KuentaDb } from '../src/data/dexie/db';
import type { DataRepository } from '../src/data/repository';
import type { SampleMovement } from './support/bbvaXlsx';
import { importFile } from './support/backupData';

let dbCount = 0;

/**
 * An onboarded repository on its own database. Onboarded on Monday 5 October 2026, so cash
 * counts from 1 October; the clock then reads Friday 20 November 2026 and can move on.
 */
async function setup() {
  const name = `kuenta-cash-test-${++dbCount}`;
  const clock = { now: new Date('2026-10-05T10:00:00') };
  const repo = createDexieRepository({ name, now: () => clock.now, appVersion: '1.2.3' });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  clock.now = new Date('2026-11-20T10:00:00');
  return { name, repo, clock, db: new KuentaDb(name) };
}

const card = (valor: string, concepto: string, importe: number): SampleMovement => ({ valor, concepto, movimiento: 'Pago con tarjeta', importe });

/**
 * A withdrawal in September, before cash counts; the October salary, paid on 30 September; two
 * withdrawals in October, a dinner a friend pays part of back, and a withdrawal and the
 * groceries in November. The starter rules put the withdrawals in "Efectivo".
 */
const movements: SampleMovement[] = [
  card('25/09/2026', 'Cajero Sol', -40),
  { valor: '30/09/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
  card('02/10/2026', 'Retirada cajero', -100),
  card('08/10/2026', 'Bar Romera', -30),
  { valor: '09/10/2026', concepto: 'Bizum', movimiento: 'Recibido: Ana cena', importe: 10 },
  card('15/10/2026', 'Cajero Centro', -50),
  card('03/11/2026', 'Mercadona', -20),
  card('10/11/2026', 'Cajero Norte', -60),
];

async function idOf(repo: DataRepository, text: string) {
  const tx = (await repo.listTransactions(null)).find((t) => t.bankConcept === text || t.note === text);
  if (!tx) throw new Error(`No transaction ${text}`);
  return tx.id;
}

async function categoryId(repo: DataRepository, name: string) {
  return (await repo.listCategories()).find((c) => c.name === name)!.id;
}

async function added(repo: DataRepository, draft: Parameters<DataRepository['addCashExpense']>[0]) {
  const result = await repo.addCashExpense(draft);
  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result)}`);
  return result.id;
}

/**
 * The movements imported, the dinner in Restaurantes with 10 € of it paid back, Nómina counting
 * from the 25th in the next month, and three cash expenses: 80 € at a restaurant on 5 October,
 * 40 € on the 16th (spilling into the second withdrawal) and 10 € of Ocio on 2 November.
 */
async function cashData(repo: DataRepository) {
  await importFile(repo, movements, 2000);
  const restaurantes = await categoryId(repo, 'Restaurantes');
  const ocio = await categoryId(repo, 'Ocio');
  await repo.updateTransaction(await idOf(repo, 'Bar Romera'), { categoryId: restaurantes });
  await repo.setReimbursements(await idOf(repo, 'Recibido: Ana cena'), [{ expenseId: await idOf(repo, 'Bar Romera'), amount: 1000 }]);
  await repo.updateCategory(await categoryId(repo, 'Nómina'), { nextMonthFromDay: 25 });
  const ids = {
    w1: await idOf(repo, 'Retirada cajero'),
    w2: await idOf(repo, 'Cajero Centro'),
    w3: await idOf(repo, 'Cajero Norte'),
    old: await idOf(repo, 'Cajero Sol'),
    e1: await added(repo, { amount: 8000, categoryId: restaurantes, date: '2026-10-05', note: 'Cena' }),
    e2: await added(repo, { amount: 4000, categoryId: restaurantes, date: '2026-10-16' }),
    e3: await added(repo, { amount: 1000, categoryId: ocio, date: '2026-11-02' }),
  };
  return { ids, restaurantes, ocio };
}

describe('where cash counts from', () => {
  it('is the first day of the month the app was set up in', async () => {
    const { db } = await setup();
    expect((await db.settings.get('cashFromDate'))?.value).toBe('2026-10-01');
  });
});

describe('a withdrawal', () => {
  it("shows how much of it the cash expenses took, what's left and those expenses with their part", async () => {
    const { repo } = await setup();
    const { ids } = await cashData(repo);
    expect((await repo.getTransaction(ids.w1))!.cash).toEqual({
      spread: 10000,
      left: 0,
      expenses: [
        { id: ids.e1, amount: 8000 },
        { id: ids.e2, amount: 2000 },
      ],
    });
    expect((await repo.getTransaction(ids.w2))!.cash).toEqual({
      spread: 3000,
      left: 2000,
      expenses: [
        { id: ids.e2, amount: 2000 },
        { id: ids.e3, amount: 1000 },
      ],
    });
    expect((await repo.getTransaction(ids.w3))!.cash).toEqual({ spread: 0, left: 6000, expenses: [] });
  });

  it('is only an imported expense in "Efectivo" from the day cash counts', async () => {
    const { repo } = await setup();
    const { ids } = await cashData(repo);
    expect((await repo.getTransaction(ids.old))!.cash).toBeNull();
    expect((await repo.getTransaction(await idOf(repo, 'Mercadona')))!.cash).toBeNull();
    // Moved to another category, it stops being one.
    await repo.updateTransaction(ids.w3, { categoryId: await categoryId(repo, 'Ocio') });
    expect((await repo.getTransaction(ids.w3))!.cash).toBeNull();
  });
});

describe('the stats with cash', () => {
  it('count withdrawals as 0 and cash expenses in their category and month, with reimbursements and a late salary', async () => {
    const { repo } = await setup();
    const { restaurantes } = await cashData(repo);
    // The withdrawal before cash counted is still spent; the salary paid on 30 September counts in October.
    expect((await repo.home('2026-09')).summary).toMatchObject({ income: 0, expenses: 4000 });
    // The dinner (30 € − 10 € paid back) and 120 € of cash expenses; the Bizum isn't income.
    expect((await repo.home('2026-10')).summary).toEqual({ income: 150000, expenses: 14000, savings: 136000, savingsRate: 136000 / 150000 });
    // The groceries and 10 € of cash, not the 60 € withdrawn.
    expect((await repo.home('2026-11')).summary).toMatchObject({ income: 0, expenses: 3000 });

    const october = await repo.spending('2026-10');
    expect(october.entries.map((entry) => [entry.category?.name, entry.amount])).toEqual([['Restaurantes', 14000]]);
    expect((await repo.spending('2026-09')).entries.map((entry) => [entry.category?.name, entry.amount])).toEqual([['Efectivo', 4000]]);

    await repo.setBudgetLimit(restaurantes, 10000, '2026-10');
    expect((await repo.budgets('2026-10')).budgets).toMatchObject([{ category: { name: 'Restaurantes' }, spent: 14000, status: 'over' }]);

    await repo.setSavingsTarget(100000, '2026-10');
    const savings = await repo.savings('2026-10');
    expect(savings).toMatchObject({ saved: 136000 });

    const monthly = await repo.monthly(6);
    expect(monthly.entries.filter((e) => e.month >= '2026-09').map((e) => [e.month, e.income, e.expenses])).toEqual([
      ['2026-09', 0, 4000],
      ['2026-10', 150000, 14000],
      ['2026-11', 0, 3000],
    ]);
  });

  it("count cash in the month's forecast instead of the withdrawals", async () => {
    const { repo } = await setup();
    await cashData(repo);
    // 30 € spent by the 20th of a 30-day month: 45 €, without the 60 € withdrawn on the 10th.
    expect((await repo.home('2026-11')).forecast).toBe(4500);
  });

  it("count cash in the subscriptions' spending this month", async () => {
    const { repo } = await setup();
    await cashData(repo);
    await added(repo, { amount: 500, categoryId: await categoryId(repo, 'Suscripciones'), date: '2026-11-12' });
    expect((await repo.subscriptions()).totals.spentThisMonth).toBe(500);
  });

  it('leave cash expenses without cash out once their withdrawal is gone, and keep them', async () => {
    const { repo } = await setup();
    const { ids } = await cashData(repo);
    const batch = (await repo.listImports())[0];
    await repo.undoImport(batch.id);
    expect(await repo.getCashExpense(ids.e1)).toMatchObject({ amount: 8000, uncovered: true });
    expect((await repo.home('2026-10')).summary).toMatchObject({ expenses: 0 });

    await importFile(repo, movements, 2000);
    expect(await repo.getCashExpense(ids.e1)).toMatchObject({ uncovered: false });
    expect((await repo.spending('2026-10')).total).toBe(12000 + 3000);
  });
});

describe('noting down a cash expense', () => {
  it('saves it with its category and counts it as a data change', async () => {
    const { repo, db, clock } = await setup();
    const { ids } = await cashData(repo);
    expect(await repo.getCashExpense(ids.e1)).toMatchObject({
      amount: 8000,
      date: '2026-10-05',
      note: 'Cena',
      category: { name: 'Restaurantes' },
      uncovered: false,
    });
    clock.now = new Date('2026-11-21T10:00:00');
    await added(repo, { amount: 1000, categoryId: await categoryId(repo, 'Ocio'), date: '2026-11-21' });
    expect((await db.settings.get('lastChangeAt'))?.value).toBe(clock.now.toISOString());
  });

  it('throws for a date in the future, an amount not above 0 and a category that says nothing of what the cash paid for', async () => {
    const { repo } = await setup();
    const { ocio } = await cashData(repo);
    await expect(repo.addCashExpense({ amount: 100, categoryId: ocio, date: '2026-11-21' })).rejects.toThrow('future');
    await expect(repo.addCashExpense({ amount: 100, categoryId: ocio, date: '2026-11-31' })).rejects.toThrow('Not a date');
    await expect(repo.addCashExpense({ amount: 0, categoryId: ocio, date: '2026-11-20' })).rejects.toThrow('above 0');
    await expect(repo.addCashExpense({ amount: 1.5, categoryId: ocio, date: '2026-11-20' })).rejects.toThrow('whole cents');
    await expect(repo.addCashExpense({ amount: 100, categoryId: await categoryId(repo, 'Efectivo'), date: '2026-11-20' })).rejects.toThrow('Efectivo');
    await expect(repo.addCashExpense({ amount: 100, categoryId: await categoryId(repo, 'Nómina'), date: '2026-11-20' })).rejects.toThrow('expense category');
  });

  it('refuses one larger than the cash held on its date', async () => {
    const { repo } = await setup();
    const { ocio } = await cashData(repo);
    // 20 € left on 6 October.
    expect(await repo.addCashExpense({ amount: 3000, categoryId: ocio, date: '2026-10-06' })).toEqual({ ok: false, reason: 'notEnough', available: 2000, later: false });
    // None before the first withdrawal that counts.
    expect(await repo.addCashExpense({ amount: 100, categoryId: ocio, date: '2026-09-28' })).toEqual({ ok: false, reason: 'notEnough', available: 0, later: false });
  });

  it('refuses one that would leave a later cash expense without cash', async () => {
    const { repo } = await setup();
    const { ocio } = await cashData(repo);
    // 30 € in hand on 20 October, but 10 € of them pay for 2 November.
    expect(await repo.addCashExpense({ amount: 2500, categoryId: ocio, date: '2026-10-20' })).toEqual({ ok: false, reason: 'notEnough', available: 2000, later: true });
    expect((await repo.addCashExpense({ amount: 2000, categoryId: ocio, date: '2026-10-20' })).ok).toBe(true);
  });
});

describe('editing and deleting a cash expense', () => {
  it('recomputes what each withdrawal paid', async () => {
    const { repo } = await setup();
    const { ids } = await cashData(repo);
    expect(await repo.updateCashExpense(ids.e1, { amount: 10000 })).toEqual({ ok: true, id: ids.e1 });
    expect((await repo.getTransaction(ids.w1))!.cash).toMatchObject({ spread: 10000, expenses: [{ id: ids.e1, amount: 10000 }] });
    expect(await repo.updateCashExpense(ids.e1, { amount: 10100 })).toEqual({ ok: false, reason: 'notEnough', available: 10000, later: false });
  });

  it('refuses an edit that would leave a later cash expense without cash', async () => {
    const { repo } = await setup();
    const { ids } = await cashData(repo);
    expect(await repo.updateCashExpense(ids.e2, { amount: 6500 })).toEqual({ ok: false, reason: 'notEnough', available: 6000, later: true });
    expect(await repo.getCashExpense(ids.e2)).toMatchObject({ amount: 4000 });
  });

  it('changes nothing when saved as it is, not even the last change', async () => {
    const { repo, db, clock } = await setup();
    const { ids, restaurantes } = await cashData(repo);
    const before = (await db.settings.get('lastChangeAt'))?.value;
    clock.now = new Date('2026-11-21T10:00:00');
    expect(await repo.updateCashExpense(ids.e1, { amount: 8000, categoryId: restaurantes, date: '2026-10-05', note: 'Cena' })).toEqual({ ok: true, id: ids.e1 });
    expect((await db.settings.get('lastChangeAt'))?.value).toBe(before);
    await repo.updateCashExpense(ids.e1, { note: 'Cena con Ana' });
    expect(await repo.getCashExpense(ids.e1)).toMatchObject({ note: 'Cena con Ana', updatedAt: clock.now.toISOString() });
    expect((await db.settings.get('lastChangeAt'))?.value).toBe(clock.now.toISOString());
  });

  it('gives the cash back to the pocket when deleted', async () => {
    const { repo } = await setup();
    const { ids } = await cashData(repo);
    await repo.deleteCashExpense(ids.e1);
    expect(await repo.getCashExpense(ids.e1)).toBeNull();
    // The two others now come from the first withdrawal.
    expect((await repo.getTransaction(ids.w1))!.cash).toEqual({
      spread: 5000,
      left: 5000,
      expenses: [
        { id: ids.e2, amount: 4000 },
        { id: ids.e3, amount: 1000 },
      ],
    });
    await expect(repo.deleteCashExpense(ids.e1)).rejects.toThrow('not found');
  });
});
