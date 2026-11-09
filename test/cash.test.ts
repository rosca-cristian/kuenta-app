import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import { KuentaDb } from '../src/data/dexie/db';
import type { DataRepository, TransactionView } from '../src/data/repository';
import { listNet } from '../src/domain/stats';
import { backupJson } from '../src/domain/backup';
import { transactionsCsv } from '../src/domain/csv';
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

describe('Movimientos with cash expenses', () => {
  const rows = (movements: Awaited<ReturnType<DataRepository['listMovements']>>) =>
    movements.map((m) => (m.kind === 'cash' ? `cash:${m.note || m.category?.name}` : `bank:${m.note || m.bankConcept}`));

  it('lists them on their dates, before the bank rows of the day, newest first', async () => {
    const { repo } = await setup();
    await cashData(repo);
    expect(rows(await repo.listMovements('2026-10'))).toEqual([
      'cash:Restaurantes',
      'bank:Cajero Centro',
      'bank:Recibido: Ana cena',
      'bank:Bar Romera',
      'cash:Cena',
      'bank:Retirada cajero',
    ]);
    expect(rows(await repo.listMovements(null)).slice(0, 4)).toEqual(['bank:Cajero Norte', 'bank:Mercadona', 'cash:Ocio', 'cash:Restaurantes']);
  });

  it('leave the day nets and the summary as the bank has them', async () => {
    const { repo } = await setup();
    await cashData(repo);
    const bank = (await repo.listMovements('2026-10')).filter((m) => m.kind === 'bank');
    expect(bank.map((tx) => tx.id)).toEqual((await repo.listTransactions('2026-10')).map((tx) => tx.id));
    expect(listNet(bank as TransactionView[])).toBe(listNet(await repo.listTransactions('2026-10')));
  });

  it('are found by their note and category name, by the category filter and by the type "Gastos en efectivo"', async () => {
    const { repo, ocio } = await (async () => {
      const s = await setup();
      return { ...s, ...(await cashData(s.repo)) };
    })();
    expect(rows(await repo.listMovements(null, { text: 'cena' }))).toEqual(['bank:Recibido: Ana cena', 'cash:Cena']);
    expect(rows(await repo.listMovements(null, { text: 'restaurantes' }))).toEqual(['cash:Restaurantes', 'cash:Cena']);
    expect(rows(await repo.listMovements(null, { categoryId: ocio }))).toEqual(['cash:Ocio']);
    expect(rows(await repo.listMovements(null, { type: 'cash' }))).toEqual(['cash:Ocio', 'cash:Restaurantes', 'cash:Cena']);
    expect(rows(await repo.listMovements('2026-10', { type: 'expense' })).every((row) => row.startsWith('bank:'))).toBe(true);
    // They have no account, payee or "sin categoría".
    const accountId = (await repo.listAccounts())[0].id;
    expect(rows(await repo.listMovements(null, { accountId })).some((row) => row.startsWith('cash:'))).toBe(false);
    expect(rows(await repo.listMovements(null, { categoryId: null })).some((row) => row.startsWith('cash:'))).toBe(false);
    expect(await repo.listTransactions(null, { type: 'cash' })).toEqual([]);
  });

  it('are never reimbursement candidates', async () => {
    const { repo } = await setup();
    await cashData(repo);
    const candidates = await repo.reimbursementCandidates(await idOf(repo, 'Recibido: Ana cena'));
    expect(candidates.every((candidate) => candidate.transaction.kind === 'bank')).toBe(true);
  });
});

describe('the cash pocket as money held', () => {
  it('adds the unspent cash to the total balance and net worth, leaving the bank account as it is', async () => {
    const { repo } = await setup();
    await cashData(repo);
    const [bbva] = await repo.listAccounts();
    // 2.000 € − 40 + 1.500 − 100 − 30 + 10 − 50 − 20 − 60 = 3.210 €, and 80 € of cash left (20 + 60).
    expect(bbva.balance).toBe(321000);
    const home = await repo.home('2026-11');
    expect(home.cash).toBe(8000);
    expect(home.totalBalance).toBe(329000);
    const worth = await repo.netWorth();
    expect(worth.points.map((p) => [p.month, p.netWorth])).toEqual([
      ['2026-09', 346000],
      // 3.290 € in the bank at the end of October, and 30 € of cash.
      ['2026-10', 329000 + 3000],
      ['2026-11', 321000 + 8000],
    ]);
    expect(worth.latest).toBe(home.totalBalance);
  });

  it('is hidden while it never had cash', async () => {
    const { repo } = await setup();
    await importFile(repo, [card('03/11/2026', 'Mercadona', -20)], 2000);
    expect((await repo.home('2026-11')).cash).toBeNull();
    expect(await repo.cashPocket()).toMatchObject({ total: 0, everHad: false, withdrawals: [], latest: [], uncovered: [] });
  });

  it('lists the withdrawals with cash left, oldest first, and the latest cash expenses, newest first', async () => {
    const { repo } = await setup();
    const { ids } = await cashData(repo);
    const pocket = await repo.cashPocket();
    expect(pocket.total).toBe(8000);
    expect(pocket.everHad).toBe(true);
    expect(pocket.withdrawals.map((w) => [w.transaction.id, w.left])).toEqual([
      [ids.w2, 2000],
      [ids.w3, 6000],
    ]);
    expect(pocket.latest.map((e) => e.id)).toEqual([ids.e3, ids.e2, ids.e1]);
    expect(pocket.uncovered).toEqual([]);
  });
});

describe("Inicio's cash reminder", () => {
  it('shows the unspent cash 3 days after the last withdrawal or cash expense, and "Más tarde" puts it off 3 days', async () => {
    const { repo, clock, db } = await setup();
    await cashData(repo);
    // The last withdrawal on 10 November, and the cash expenses were noted down on the 20th.
    expect((await repo.home('2026-11')).cashReminder).toBeNull();
    clock.now = new Date('2026-11-23T09:00:00');
    expect((await repo.home('2026-11')).cashReminder).toBe(8000);

    const before = (await db.settings.get('lastChangeAt'))?.value;
    await repo.postponeCashReminder();
    expect((await repo.home('2026-11')).cashReminder).toBeNull();
    expect((await db.settings.get('lastChangeAt'))?.value).toBe(before);
    clock.now = new Date('2026-11-25T22:00:00');
    expect((await repo.home('2026-11')).cashReminder).toBeNull();
    clock.now = new Date('2026-11-26T08:00:00');
    expect((await repo.home('2026-11')).cashReminder).toBe(8000);

    // Noting down a cash expense puts it off too.
    await added(repo, { amount: 1000, categoryId: await categoryId(repo, 'Ocio'), date: '2026-11-26' });
    expect((await repo.home('2026-11')).cashReminder).toBeNull();
  });

  it("keeps when it was put off through a restore: it belongs to this phone", async () => {
    const { repo, db } = await setup();
    await cashData(repo);
    const backup = await repo.exportBackup();
    await repo.postponeCashReminder();
    const at = (await db.settings.get('cashReminderAt'))?.value;
    await repo.restoreBackup(backup);
    expect((await db.settings.get('cashReminderAt'))?.value).toBe(at);
    expect(backup.data.settings.some((row) => row.key === 'cashReminderAt')).toBe(false);
  });
});

describe('keeping cash expenses when their cash goes away', () => {
  it('counts the cash expenses undoing an import would leave without cash, and they count again once reimported', async () => {
    const { repo } = await setup();
    const { ids } = await cashData(repo);
    const batch = (await repo.listImports())[0];
    expect(await repo.cashExpensesUncoveredBy({ undoImport: batch.id })).toBe(3);
    await repo.undoImport(batch.id);
    expect((await repo.cashPocket()).uncovered.map((e) => e.id)).toEqual([ids.e3, ids.e2, ids.e1]);
    expect((await repo.listMovements(null, { type: 'cash' })).every((m) => m.kind === 'cash' && m.uncovered)).toBe(true);
    await importFile(repo, movements, 2000);
    expect((await repo.cashPocket()).uncovered).toEqual([]);
    expect((await repo.home('2026-11')).summary.expenses).toBe(3000);
  });

  it("counts those changing a withdrawal's category or making it a transfer would leave without cash", async () => {
    const { repo } = await setup();
    const { ids, ocio } = await cashData(repo);
    // Without the first withdrawal, the 80 € dinner on 5 October has no cash; the second one pays the rest.
    expect(await repo.cashExpensesUncoveredBy({ transactionId: ids.w1, changes: { categoryId: ocio } })).toBe(1);
    expect(await repo.cashExpensesUncoveredBy({ transactionId: ids.w3, changes: { categoryId: ocio } })).toBe(0);
    const { id: revolut } = (await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string };
    expect(await repo.cashExpensesUncoveredBy({ transactionId: ids.w2, changes: { transferAccountId: revolut } })).toBe(1);
    // Saved, they're kept and marked.
    await repo.updateTransaction(ids.w1, { categoryId: ocio });
    expect(await repo.getCashExpense(ids.e1)).toMatchObject({ uncovered: true });
    expect(await repo.getCashExpense(ids.e2)).toMatchObject({ uncovered: false });
    // And back in "Efectivo", the cash pays them again.
    await repo.updateTransaction(ids.w1, { categoryId: await categoryId(repo, 'Efectivo') });
    expect(await repo.getCashExpense(ids.e1)).toMatchObject({ uncovered: false });
  });

  it('never lets rules change them', async () => {
    const { repo } = await setup();
    const { ids, ocio } = await cashData(repo);
    await repo.createRule({ name: 'Todo ocio', match: { value: 'a' }, actions: { categoryId: ocio } });
    await repo.applyRules();
    expect(await repo.getCashExpense(ids.e1)).toMatchObject({ category: { name: 'Restaurantes' }, note: 'Cena' });
  });

  it('moves them with the category deleted, only to another expense category than "Efectivo"', async () => {
    const { repo } = await setup();
    const { ids, restaurantes, ocio } = await cashData(repo);
    expect(await repo.categoryUsage(restaurantes)).toMatchObject({ transactions: 1, cashExpenses: 2 });
    await expect(repo.deleteCategory(restaurantes, null)).rejects.toThrow('another expense category');
    await expect(repo.deleteCategory(restaurantes, await categoryId(repo, 'Efectivo'))).rejects.toThrow('another expense category');
    await expect(repo.deleteCategory(restaurantes, await categoryId(repo, 'Nómina'))).rejects.toThrow('another expense category');
    await repo.deleteCategory(restaurantes, ocio);
    expect(await repo.getCashExpense(ids.e1)).toMatchObject({ categoryId: ocio });
    expect(await repo.getCashExpense(ids.e2)).toMatchObject({ categoryId: ocio });
  });
});

describe('Contar el efectivo desde', () => {
  it('moves where the pocket starts, warning of the cash expenses it would leave without cash', async () => {
    const { repo, db, clock } = await setup();
    const { ids } = await cashData(repo);
    expect((await repo.getSettings()).cashFromDate).toBe('2026-10-01');
    expect(await repo.cashExpensesUncoveredBy({ cashFromDate: '2026-10-10' })).toBe(1);
    clock.now = new Date('2026-11-21T10:00:00');
    await repo.setCashFromDate('2026-10-10');
    expect((await db.settings.get('lastChangeAt'))?.value).toBe(clock.now.toISOString());
    expect(await repo.getCashExpense(ids.e1)).toMatchObject({ uncovered: true });
    // The first withdrawal counts as spent again.
    expect((await repo.spending('2026-10')).entries.map((e) => [e.category?.name, e.amount])).toEqual([
      ['Efectivo', 10000],
      ['Restaurantes', 2000 + 4000],
    ]);

    // Earlier, the September withdrawal goes to the pocket too.
    expect(await repo.cashExpensesUncoveredBy({ cashFromDate: '2026-09-01' })).toBe(0);
    clock.now = new Date('2026-11-22T10:00:00');
    await repo.setCashFromDate('2026-10-10');
    expect((await db.settings.get('lastChangeAt'))?.value).not.toBe(clock.now.toISOString());
    await expect(repo.setCashFromDate('2026-10-32')).rejects.toThrow('Not a date');
  });
});

describe('cash expenses in backups', () => {
  async function fresh() {
    const name = `kuenta-cash-test-${++dbCount}`;
    return { name, repo: createDexieRepository({ name, now: () => new Date('2026-11-20T10:00:00'), appVersion: '1.2.3' }), db: new KuentaDb(name) };
  }

  it('travel in a backup with "Contar el efectivo desde" and come back with a restore, counting as before', async () => {
    const { repo, db } = await setup();
    const { ids } = await cashData(repo);
    const backup = await repo.exportBackup();
    expect(backup.format).toBe(4);
    expect(backup.data.cashExpenses).toEqual(await db.cashExpenses.toArray());
    expect(backup.data.settings).toContainEqual({ key: 'cashFromDate', value: '2026-10-01' });

    const target = await fresh();
    const read = target.repo.readBackup(backupJson(backup));
    if (!read.ok) throw new Error(JSON.stringify(read.error));
    expect(read.summary.cashExpenses).toBe(3);
    await target.repo.restoreBackup(read.backup);
    expect(await target.db.cashExpenses.toArray()).toEqual(await db.cashExpenses.toArray());
    expect((await target.repo.getSettings()).cashFromDate).toBe('2026-10-01');
    expect((await target.repo.home('2026-10')).summary).toEqual((await repo.home('2026-10')).summary);
    expect((await target.repo.getTransaction(ids.w1))!.cash).toEqual((await repo.getTransaction(ids.w1))!.cash);
    expect(await target.repo.dataCounts()).toMatchObject({ cashExpenses: 3 });
  });

  it('replace the cash expenses already on the phone', async () => {
    const { repo, db } = await setup();
    await cashData(repo);
    const target = await setup();
    await cashData(target.repo);
    const read = target.repo.readBackup(backupJson(await repo.exportBackup()));
    if (!read.ok) throw new Error(JSON.stringify(read.error));
    await target.repo.restoreBackup(read.backup);
    expect((await target.db.cashExpenses.toArray()).map((e) => e.id).sort()).toEqual((await db.cashExpenses.toArray()).map((e) => e.id).sort());
  });

  it('are none in a format 3 copy, which counts cash from its own month so the past stays as it was', async () => {
    const { repo } = await setup();
    await cashData(repo);
    const backup = await repo.exportBackup();
    const { cashExpenses, ...data } = backup.data;
    expect(cashExpenses).toHaveLength(3);
    const formatThree = JSON.stringify({ ...backup, format: 3, data: { ...data, settings: data.settings.filter((s) => s.key !== 'cashFromDate') } });

    const target = await fresh();
    const read = target.repo.readBackup(formatThree);
    if (!read.ok) throw new Error(JSON.stringify(read.error));
    expect(read.backup.format).toBe(4);
    expect(read.backup.data.cashExpenses).toEqual([]);
    expect(read.backup.data.settings).toContainEqual({ key: 'cashFromDate', value: '2026-11-01' });
    await target.repo.restoreBackup(read.backup);
    // October's withdrawals count as spent, as they did when the copy was made.
    expect((await target.repo.spending('2026-10')).entries.map((e) => [e.category?.name, e.amount])).toEqual([
      ['Efectivo', 15000],
      ['Restaurantes', 2000],
    ]);
  });

  it.each([
    ['an amount not above 0', (file: BackupJson) => void (file.data.cashExpenses[1].amount = 0), { kind: 'invalid', table: 'cashExpenses', row: 1, field: 'amount' }],
    ['an amount not in whole cents', (file: BackupJson) => void (file.data.cashExpenses[0].amount = 12.5), { kind: 'invalid', table: 'cashExpenses', row: 0, field: 'amount' }],
    ['a date that is not one', (file: BackupJson) => void (file.data.cashExpenses[0].date = '2026-13-01'), { kind: 'invalid', table: 'cashExpenses', row: 0, field: 'date' }],
    ['a missing category', (file: BackupJson) => void (file.data.cashExpenses[2].categoryId = 'gone'), { kind: 'reference', table: 'cashExpenses', field: 'categoryId', target: 'categories' }],
    ['the "Efectivo" category', (file: BackupJson) => void (file.data.cashExpenses[2].categoryId = categoryNamed(file, 'Efectivo')), { kind: 'invalid', table: 'cashExpenses', row: 2, field: 'categoryId' }],
    ['an income category', (file: BackupJson) => void (file.data.cashExpenses[0].categoryId = categoryNamed(file, 'Nómina')), { kind: 'invalid', table: 'cashExpenses', row: 0, field: 'categoryId' }],
    ['a repeated id', (file: BackupJson) => void (file.data.cashExpenses[1].id = file.data.cashExpenses[0].id), { kind: 'duplicate', table: 'cashExpenses', field: 'id' }],
    ['a start date that is not a date', (file: BackupJson) => void (file.data.settings.find((s) => s.key === 'cashFromDate')!.value = 'octubre'), { kind: 'invalid', table: 'settings', row: expect.any(Number), field: 'value' }],
  ])('refuse a copy with a cash expense with %s', async (_, damage, expected) => {
    const { repo } = await setup();
    await cashData(repo);
    const file = JSON.parse(backupJson(await repo.exportBackup())) as BackupJson;
    damage(file);
    expect(repo.readBackup(JSON.stringify(file))).toEqual({ ok: false, error: { reason: 'damaged', damage: expected } });
  });
});

type BackupJson = { data: { cashExpenses: Record<string, unknown>[]; categories: { id: string; name: string }[]; settings: { key: string; value: unknown }[] } };
const categoryNamed = (file: BackupJson, name: string) => file.data.categories.find((c) => c.name === name)!.id;

describe('cash in the CSV', () => {
  it('lists cash expenses as their own lines and names the withdrawals', async () => {
    const { repo } = await setup();
    await cashData(repo);
    const lines = transactionsCsv(await repo.listMovements('2026-10')).trim().split('\r\n');
    expect(lines.filter((line) => line.includes('efectivo'))).toEqual([
      '02/10/2026;Retirada de efectivo;BBVA;;Efectivo;Retirada Cajero;;-100,00;;Retirada cajero',
      '05/10/2026;Gasto en efectivo;Efectivo;;Restaurantes;;Cena;-80,00;;',
      '15/10/2026;Retirada de efectivo;BBVA;;Efectivo;Cajero Centro;;-50,00;;Cajero Centro',
      '16/10/2026;Gasto en efectivo;Efectivo;;Restaurantes;;;-40,00;;',
    ]);
    // The September withdrawal, from before cash counted, is still an ordinary expense.
    expect(transactionsCsv(await repo.listMovements('2026-09'))).toContain('25/09/2026;Gasto;BBVA;;Efectivo;Cajero Sol;;-40,00;;Cajero Sol');
  });
});
