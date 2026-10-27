import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import { KuentaDb } from '../src/data/dexie/db';
import type { DataRepository, TransactionView } from '../src/data/repository';
import { backupJson } from '../src/domain/backup';
import { listNet } from '../src/domain/stats';
import type { SampleMovement } from './support/bbvaXlsx';
import { importFile } from './support/backupData';

let dbCount = 0;

/** An onboarded repository on its own database, whose clock reads Tuesday 20 October 2026 and can move on. */
async function setup() {
  const name = `kuenta-reimbursements-test-${++dbCount}`;
  const clock = { now: new Date('2026-10-20T10:00:00') };
  const repo = createDexieRepository({ name, now: () => clock.now, appVersion: '1.2.3' });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return { name, repo, clock, db: new KuentaDb(name) };
}

const card = (valor: string, concepto: string, importe: number): SampleMovement => ({ valor, concepto, movimiento: 'Pago con tarjeta', importe });
const bizum = (valor: string, note: string, importe: number): SampleMovement => ({ valor, concepto: 'Bizum', movimiento: note, importe });

/**
 * A dinner in September paid back in October, the salary, a shop and a chemist the parents
 * pay back with one Bizum, and a dinner three friends pay back with a Bizum each.
 */
const movements: SampleMovement[] = [
  card('25/09/2026', 'Casa Pepe', -100),
  { valor: '01/10/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
  card('03/10/2026', 'Mercadona', -60),
  card('04/10/2026', 'Farmacia Sol', -25),
  bizum('05/10/2026', 'Recibido: compra papás', 80),
  bizum('06/10/2026', 'Recibido: cena septiembre', 60),
  card('10/10/2026', 'Bar Romera', -73.5),
  bizum('10/10/2026', 'Recibido: Ana cena', 38.05),
  bizum('11/10/2026', 'Recibido: Luis cena', 9.85),
  bizum('12/10/2026', 'Recibido: Eva cena', 15.65),
];

/** The id of the transaction with this bank concept or (a Bizum) note. */
async function idOf(repo: DataRepository, text: string) {
  const tx = (await repo.listTransactions(null)).find((t) => t.bankConcept === text || t.note === text);
  if (!tx) throw new Error(`No transaction ${text}`);
  return tx.id;
}

async function categoryId(repo: DataRepository, name: string) {
  return (await repo.listCategories()).find((c) => c.name === name)!.id;
}

/** The movements imported, the shops categorized (Mercadona by its starter rule) and every reimbursement linked. */
async function linkedData(repo: DataRepository) {
  await importFile(repo, movements, 2000);
  const restaurantes = await categoryId(repo, 'Restaurantes');
  await repo.updateTransaction(await idOf(repo, 'Casa Pepe'), { categoryId: restaurantes });
  await repo.updateTransaction(await idOf(repo, 'Bar Romera'), { categoryId: restaurantes });
  await repo.updateTransaction(await idOf(repo, 'Farmacia Sol'), { categoryId: await categoryId(repo, 'Salud') });
  const ids = {
    casaPepe: await idOf(repo, 'Casa Pepe'),
    mercadona: await idOf(repo, 'Mercadona'),
    farmacia: await idOf(repo, 'Farmacia Sol'),
    romera: await idOf(repo, 'Bar Romera'),
    papas: await idOf(repo, 'Recibido: compra papás'),
    septiembre: await idOf(repo, 'Recibido: cena septiembre'),
    ana: await idOf(repo, 'Recibido: Ana cena'),
    luis: await idOf(repo, 'Recibido: Luis cena'),
    eva: await idOf(repo, 'Recibido: Eva cena'),
    nomina: await idOf(repo, 'Abono de nómina'),
  };
  return { ids, restaurantes };
}

async function linkAll(repo: DataRepository, ids: Awaited<ReturnType<typeof linkedData>>['ids']) {
  await repo.setReimbursements(ids.ana, [{ expenseId: ids.romera, amount: 3805 }]);
  await repo.setReimbursements(ids.luis, [{ expenseId: ids.romera, amount: 985 }]);
  await repo.setReimbursements(ids.eva, [{ expenseId: ids.romera, amount: 1565 }]);
  await repo.setReimbursements(ids.papas, [
    { expenseId: ids.mercadona, amount: 6000 },
    { expenseId: ids.farmacia, amount: 2000 },
  ]);
  await repo.setReimbursements(ids.septiembre, [{ expenseId: ids.casaPepe, amount: 6000 }]);
}

const view = async (repo: DataRepository, id: string) => (await repo.getTransaction(id)) as TransactionView;

describe('linking an income to the expenses it pays back', () => {
  it('shows on both sides: what was paid back of an expense, and what an income spreads', async () => {
    const { repo } = await setup();
    const { ids } = await linkedData(repo);
    expect((await view(repo, ids.romera)).reimbursement).toBeNull();
    await linkAll(repo, ids);

    expect((await view(repo, ids.romera)).reimbursement).toEqual({
      paidBack: 6355,
      spread: 0,
      links: [
        { transactionId: ids.ana, amount: 3805 },
        { transactionId: ids.luis, amount: 985 },
        { transactionId: ids.eva, amount: 1565 },
      ],
    });
    expect((await view(repo, ids.papas)).reimbursement).toEqual({
      paidBack: 0,
      spread: 8000,
      links: [
        { transactionId: ids.mercadona, amount: 6000 },
        { transactionId: ids.farmacia, amount: 2000 },
      ],
    });
    // Movimientos keeps the bank's amounts, with the links on each view.
    const listed = await repo.listTransactions('2026-10');
    expect(listed.find((tx) => tx.id === ids.romera)).toMatchObject({ amount: 7350, reimbursement: { paidBack: 6355 } });
    expect(listed.find((tx) => tx.id === ids.nomina)!.reimbursement).toBeNull();
  });

  it("makes Inicio's income, expenses and savings rate count your part only, without changing any balance", async () => {
    const { repo } = await setup();
    const { ids } = await linkedData(repo);
    const before = await repo.home('2026-10');
    expect(before.summary).toMatchObject({ income: 170355, expenses: 15850 });
    const netWorth = await repo.netWorth();

    await linkAll(repo, ids);
    const after = await repo.home('2026-10');
    // 9,95 € of the dinner, 5 € of the chemist and nothing of Mercadona; only the salary is income.
    expect(after.summary).toEqual({ income: 150000, expenses: 1495, savings: 148505, savingsRate: 148505 / 150000 });
    expect((await repo.home('2026-09')).summary).toMatchObject({ income: 0, expenses: 4000 });
    expect(after.totalBalance).toBe(before.totalBalance);
    expect(after.accounts.map((a) => a.balance)).toEqual(before.accounts.map((a) => a.balance));
    expect(await repo.netWorth()).toEqual(netWorth);
  });

  it('makes Análisis → Gastos, Mensual and the budgets count your part, in the month of the expense', async () => {
    const { repo } = await setup();
    const { ids, restaurantes } = await linkedData(repo);
    await repo.setBudgetLimit(restaurantes, 10000, '2026-09');
    await linkAll(repo, ids);

    const october = await repo.spending('2026-10');
    expect(october.entries.map((e) => [e.category?.name, e.amount])).toEqual([
      ['Restaurantes', 995],
      ['Salud', 500],
    ]);
    expect(october.total).toBe(1495);
    expect((await repo.spending('2026-09')).entries.map((e) => [e.category?.name, e.amount])).toEqual([['Restaurantes', 4000]]);

    expect((await repo.monthly(6)).entries.map((e) => [e.month, e.income, e.expenses])).toEqual([
      ['2026-09', 0, 4000],
      ['2026-10', 150000, 1495],
    ]);
    expect((await repo.budgets('2026-09')).budgets).toMatchObject([{ category: { name: 'Restaurantes' }, spent: 4000 }]);
    expect((await repo.budgets('2026-10')).budgets).toMatchObject([{ category: { name: 'Restaurantes' }, spent: 995 }]);
  });

  it("makes a subscription a friend pays half of cost your part, in its charge and this month's spending", async () => {
    const { repo } = await setup();
    const suscripciones = await categoryId(repo, 'Suscripciones');
    await repo.createRule({ name: 'Netflix', match: { value: 'netflix' }, actions: { categoryId: suscripciones } });
    await importFile(repo, [card('05/10/2026', 'Netflix', -17.99), bizum('06/10/2026', 'Recibido: netflix', 9)], 1000);
    await repo.setReimbursements(await idOf(repo, 'Recibido: netflix'), [{ expenseId: await idOf(repo, 'Netflix'), amount: 900 }]);

    const view = await repo.subscriptions();
    expect(view.subscriptions).toMatchObject([{ payee: { name: 'Netflix' }, lastAmount: 899, monthlyAmount: 899 }]);
    expect(view.totals).toEqual({ monthly: 899, yearly: 899 * 12, spentThisMonth: 899 });
  });

  it('keeps the forecast, goals and Movimientos on the bank amounts', async () => {
    const { repo } = await setup();
    const { ids } = await linkedData(repo);
    const { id: hucha } = (await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'green' })) as { id: string };
    await repo.createGoal({ name: 'BBVA', target: 500000, accountId: (await repo.listAccounts())[0].id, icon: 'plane', color: 'cyan' });
    await repo.createGoal({ name: 'Hucha', target: 1000, accountId: hucha, icon: 'plane', color: 'cyan' });
    const before = await repo.home('2026-10');
    const listed = (await repo.listTransactions(null)).map((tx) => [tx.id, tx.amount]);
    await linkAll(repo, ids);
    const after = await repo.home('2026-10');
    expect(after.forecast).not.toBeNull();
    expect(after.forecast).toBe(before.forecast);
    expect(after.goals).toEqual(before.goals);
    expect((await repo.listTransactions(null)).map((tx) => [tx.id, tx.amount])).toEqual(listed);
    expect((await view(repo, ids.ana)).amount).toBe(3805);
  });

  it("keeps Movimientos' summary and day totals on the bank amounts", async () => {
    const { repo } = await setup();
    const { ids } = await linkedData(repo);
    /** The month's net and each day's, as the summary line and the day headers sum them. */
    const totals = async () => {
      const listed = await repo.listTransactions('2026-10');
      const days = Map.groupBy(listed, (tx) => tx.date);
      return { summary: listNet(listed), days: [...days].map(([date, txs]) => [date, listNet(txs)]) };
    };
    const before = await totals();
    await linkAll(repo, ids);
    expect(await totals()).toEqual(before);
    expect(before.summary).toBe(150000 - 6000 - 2500 - 7350 + 8000 + 6000 + 3805 + 985 + 1565);
  });

  it('lists the incomes that pay back an expense with the "reimbursement" type', async () => {
    const { repo } = await setup();
    const { ids } = await linkedData(repo);
    const reimbursements = async (filter: { text?: string } = {}) =>
      (await repo.listTransactions('2026-10', { ...filter, type: 'reimbursement' })).map((tx) => tx.id);
    expect(await reimbursements()).toEqual([]);

    await linkAll(repo, ids);
    // Newest first, as the list is, with the links on each view; never an expense.
    expect(await reimbursements()).toEqual([ids.eva, ids.luis, ids.ana, ids.septiembre, ids.papas]);
    const [eva] = await repo.listTransactions('2026-10', { type: 'reimbursement' });
    expect(eva.reimbursement).toEqual({ paidBack: 0, spread: 1565, links: [{ transactionId: ids.romera, amount: 1565 }] });
    // With the other filters, all of which must hold.
    expect(await reimbursements({ text: 'papas' })).toEqual([ids.papas]);
    expect((await repo.listTransactions('2026-10', { type: 'reimbursement', categoryId: null })).length).toBe(5);
    expect((await repo.listTransactions('2026-09', { type: 'reimbursement' })).map((tx) => tx.id)).toEqual([]);

    // Unlinked, it's an ordinary income again.
    await repo.setReimbursements(ids.papas, []);
    expect(await reimbursements()).not.toContain(ids.papas);
    expect((await repo.listTransactions('2026-10', { type: 'income' })).map((tx) => tx.id)).toContain(ids.papas);
  });

  it('replaces the links of the income, drops a part of 0, and removes them all with none', async () => {
    const { repo } = await setup();
    const { ids } = await linkedData(repo);
    await repo.setReimbursements(ids.papas, [
      { expenseId: ids.mercadona, amount: 6000 },
      { expenseId: ids.farmacia, amount: 2000 },
    ]);
    await repo.setReimbursements(ids.papas, [
      { expenseId: ids.mercadona, amount: 0 },
      { expenseId: ids.farmacia, amount: 2500 },
    ]);
    expect((await view(repo, ids.papas)).reimbursement).toEqual({ paidBack: 0, spread: 2500, links: [{ transactionId: ids.farmacia, amount: 2500 }] });
    expect((await view(repo, ids.mercadona)).reimbursement).toBeNull();

    await repo.setReimbursements(ids.papas, []);
    expect((await view(repo, ids.papas)).reimbursement).toBeNull();
    expect((await repo.home('2026-10')).summary.income).toBe(170355);
  });

  it('refuses what breaks the rules, changing nothing', async () => {
    const { repo, db } = await setup();
    const { ids } = await linkedData(repo);
    await repo.setReimbursements(ids.ana, [{ expenseId: ids.romera, amount: 3805 }]);
    await repo.updateAccountBalance((await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'green' }) as { id: string }).id, 100);
    const adjustment = (await repo.listTransactions(null)).find((tx) => tx.source === 'adjustment')!;
    const rows = await db.reimbursements.toArray();

    const refusals: [string, () => Promise<void>][] = [
      ['an expense as the income', () => repo.setReimbursements(ids.romera, [{ expenseId: ids.mercadona, amount: 100 }])],
      ['an income as the expense', () => repo.setReimbursements(ids.luis, [{ expenseId: ids.eva, amount: 100 }])],
      ['a balance adjustment as the income', () => repo.setReimbursements(adjustment.id, [{ expenseId: ids.romera, amount: 100 }])],
      ['an unknown expense', () => repo.setReimbursements(ids.luis, [{ expenseId: 'nope', amount: 100 }])],
      ['a negative part', () => repo.setReimbursements(ids.luis, [{ expenseId: ids.romera, amount: -100 }])],
      ['a part that is not whole cents', () => repo.setReimbursements(ids.luis, [{ expenseId: ids.romera, amount: 1.5 }])],
      ['more than the income', () => repo.setReimbursements(ids.luis, [{ expenseId: ids.romera, amount: 986 }])],
      [
        'the same expense twice',
        () =>
          repo.setReimbursements(ids.papas, [
            { expenseId: ids.mercadona, amount: 100 },
            { expenseId: ids.mercadona, amount: 200 },
          ]),
      ],
      // 73,50 € − 38,05 € paid back by Ana leaves 35,45 €.
      ['more than what other incomes left of the expense', () => repo.setReimbursements(ids.papas, [{ expenseId: ids.romera, amount: 3546 }])],
    ];
    for (const [what, write] of refusals) await expect(write(), what).rejects.toThrow();
    expect(await db.reimbursements.toArray()).toEqual(rows);

    // Up to what's left is fine.
    await repo.setReimbursements(ids.papas, [{ expenseId: ids.romera, amount: 3545 }]);
    expect((await view(repo, ids.romera)).reimbursement!.paidBack).toBe(7350);
  });

  it('records a change only when the links differ', async () => {
    const { repo, clock, db } = await setup();
    const { ids } = await linkedData(repo);
    clock.now = new Date('2026-10-20T11:00:00');
    let notified = 0;
    repo.subscribe(() => notified++);

    await repo.setReimbursements(ids.ana, [{ expenseId: ids.romera, amount: 3805 }]);
    expect(notified).toBe(1);
    expect((await db.settings.get('lastChangeAt'))!.value).toBe(clock.now.toISOString());

    clock.now = new Date('2026-10-20T12:00:00');
    await repo.setReimbursements(ids.ana, [{ expenseId: ids.romera, amount: 3805 }]);
    await repo.setReimbursements(ids.luis, [{ expenseId: ids.romera, amount: 0 }]);
    expect(notified).toBe(1);
    expect((await db.settings.get('lastChangeAt'))!.value).toBe(new Date('2026-10-20T11:00:00').toISOString());

    await repo.setReimbursements(ids.ana, [{ expenseId: ids.romera, amount: 3800 }]);
    expect(notified).toBe(2);
    expect((await db.settings.get('lastChangeAt'))!.value).toBe(clock.now.toISOString());
  });

  it("ignores links whose income or expense is gone or isn't one any more", async () => {
    const { repo, db } = await setup();
    const { ids } = await linkedData(repo);
    await linkAll(repo, ids);
    const { id: revolut } = (await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string };

    // The dinner's Bizum from Eva made a transfer, and Luis's gone from the database.
    await repo.updateTransaction(ids.eva, { transferAccountId: revolut });
    await db.transactions.delete(ids.luis);
    expect((await view(repo, ids.romera)).reimbursement).toMatchObject({ paidBack: 3805, links: [{ transactionId: ids.ana }] });
    expect((await repo.home('2026-10')).summary.expenses).toBe(500 + 7350 - 3805);
    expect((await repo.spending('2026-10')).entries.find((e) => e.category?.name === 'Restaurantes')!.amount).toBe(7350 - 3805);
  });
  it('drops the links of a transaction made a transfer, by hand or by a rule, for good', async () => {
    const { repo, db } = await setup();
    const { ids } = await linkedData(repo);
    await linkAll(repo, ids);
    const { id: revolut } = (await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string };

    // The September dinner's Bizum made a transfer and back: Casa Pepe is whole again, and can be paid back by another.
    await repo.updateTransaction(ids.septiembre, { transferAccountId: revolut });
    await repo.updateTransaction(ids.septiembre, { transferAccountId: null });
    expect((await view(repo, ids.septiembre)).reimbursement).toBeNull();
    await repo.setReimbursements(ids.nomina, [{ expenseId: ids.casaPepe, amount: 10000 }]);
    expect((await view(repo, ids.casaPepe)).reimbursement).toMatchObject({ paidBack: 10000 });

    // A rule turning the never-edited parents' Bizum into a transfer drops its links too.
    await repo.createRule({ name: 'Papás', match: { value: 'compra papas' }, actions: { transferAccountId: revolut } });
    await repo.applyRules();
    expect((await view(repo, ids.papas)).type).toBe('transfer');
    expect(await db.reimbursements.where('incomeId').equals(ids.papas).count()).toBe(0);
    expect((await view(repo, ids.mercadona)).reimbursement).toBeNull();
  });
});

describe('keeping the links consistent', () => {
  it('keeps the links when the category, payee or note of either side changes', async () => {
    const { repo, db } = await setup();
    const { ids } = await linkedData(repo);
    await linkAll(repo, ids);
    const rows = await db.reimbursements.toArray();

    await repo.updateTransaction(ids.romera, { categoryId: await categoryId(repo, 'Ocio'), payeeName: 'Romera', note: 'Cumpleaños de Ana' });
    await repo.updateTransaction(ids.ana, { categoryId: await categoryId(repo, 'Otros ingresos'), payeeName: 'Ana', note: 'Su parte' });
    await repo.updateTransaction(ids.ana, { categoryId: null });
    expect(await db.reimbursements.toArray()).toEqual(rows);
    expect((await view(repo, ids.romera)).reimbursement).toMatchObject({ paidBack: 6355 });
  });

  /**
   * The linked data, and a second import: a cinema ticket paid back by Bizum, and a Bizum from
   * Pablo for what was left of the dinner from the first import.
   */
  async function twoImports(repo: DataRepository) {
    const { ids } = await linkedData(repo);
    await linkAll(repo, ids);
    const { batch } = await importFile(
      repo,
      [card('15/10/2026', 'Cine Luna', -20), bizum('16/10/2026', 'Recibido: cine', 10), bizum('17/10/2026', 'Recibido: Pablo cena', 9.95)],
      3445.05,
    );
    const later = {
      cine: await idOf(repo, 'Cine Luna'),
      cineBizum: await idOf(repo, 'Recibido: cine'),
      pablo: await idOf(repo, 'Recibido: Pablo cena'),
    };
    await repo.setReimbursements(later.cineBizum, [{ expenseId: later.cine, amount: 1000 }]);
    await repo.setReimbursements(later.pablo, [{ expenseId: ids.romera, amount: 995 }]);
    return { ids, later, batchId: batch.id };
  }

  it("undoing an import deletes the links of its transactions, also those to another import's", async () => {
    const { repo, db } = await setup();
    const { ids, later, batchId } = await twoImports(repo);
    expect((await view(repo, ids.romera)).reimbursement).toMatchObject({ paidBack: 7350 });
    const firstImport = (await db.reimbursements.toArray()).filter(
      (link) => link.incomeId !== later.cineBizum && link.incomeId !== later.pablo,
    );

    await repo.undoImport(batchId);
    expect(await db.reimbursements.toArray()).toEqual(firstImport);
    // The dinner is left with its three friends' parts: "Tu parte" is 9,95 € again.
    expect((await view(repo, ids.romera)).reimbursement).toMatchObject({
      paidBack: 6355,
      links: [{ transactionId: ids.ana }, { transactionId: ids.luis }, { transactionId: ids.eva }],
    });
    expect((await repo.home('2026-10')).summary).toMatchObject({ income: 150000, expenses: 1495 });
    expect((await repo.spending('2026-10')).entries.find((e) => e.category?.name === 'Restaurantes')!.amount).toBe(995);
  });

  it('undoing the import an expense came in leaves the incomes of another import that paid it back whole again', async () => {
    const { repo, db } = await setup();
    const { later, batchId } = await twoImports(repo);
    const first = (await repo.listImports()).find((batch) => batch.id !== batchId)!;

    await repo.undoImport(first.id);
    expect((await db.reimbursements.toArray()).map((link) => link.incomeId)).toEqual([later.cineBizum]);
    expect((await view(repo, later.pablo)).reimbursement).toBeNull();
    expect((await view(repo, later.cine)).reimbursement).toMatchObject({ paidBack: 1000 });
    // Pablo's Bizum counts as income again; the cinema is half paid back.
    expect((await repo.home('2026-10')).summary).toMatchObject({ income: 995, expenses: 1000 });
  });
});

describe('the expenses "Es un reembolso" offers', () => {
  it('lists the imported expenses of the 30 days up to the income, closest first, with what is left of each', async () => {
    const { repo } = await setup();
    const { ids } = await linkedData(repo);
    await repo.setReimbursements(ids.ana, [{ expenseId: ids.romera, amount: 3805 }]);

    const candidates = await repo.reimbursementCandidates(ids.eva);
    expect(candidates.map((c) => [c.transaction.bankConcept, c.left, c.part])).toEqual([
      ['Bar Romera', 3545, 0],
      ['Farmacia Sol', 2500, 0],
      ['Mercadona', 6000, 0],
      ['Casa Pepe', 10000, 0],
    ]);
    // An income's own parts are left to edit again.
    expect((await repo.reimbursementCandidates(ids.ana))[0]).toMatchObject({ transaction: { id: ids.romera }, left: 7350, part: 3805 });
  });

  it('leaves out the expenses paid back whole by other incomes, and those after the income', async () => {
    const { repo } = await setup();
    const { ids } = await linkedData(repo);
    await repo.setReimbursements(ids.papas, [
      { expenseId: ids.mercadona, amount: 6000 },
      { expenseId: ids.farmacia, amount: 2000 },
    ]);
    const candidates = await repo.reimbursementCandidates(ids.septiembre);
    expect(candidates.map((c) => [c.transaction.bankConcept, c.left])).toEqual([
      ['Farmacia Sol', 500],
      ['Casa Pepe', 10000],
    ]);
  });

  it('searches the payee, note, concept and movement ignoring case and accents', async () => {
    const { repo } = await setup();
    const { ids } = await linkedData(repo);
    await repo.updateTransaction(ids.romera, { note: 'Cumpleaños de Ana' });
    const found = async (text: string) => (await repo.reimbursementCandidates(ids.eva, { text })).map((c) => c.transaction.bankConcept);
    expect(await found('ROMERA')).toEqual(['Bar Romera']);
    expect(await found('cumpleanos')).toEqual(['Bar Romera']);
    expect(await found('farmacia sol')).toEqual(['Farmacia Sol']);
    expect(await found('pago con tarjeta')).toHaveLength(4);
    expect(await found('nada')).toEqual([]);
  });

  it('reaches older expenses with "Ver gastos anteriores", and always keeps those already linked', async () => {
    const { repo } = await setup();
    await importFile(repo, [card('15/08/2026', 'Hotel Playa', -300), card('20/09/2026', 'Tren', -40), bizum('15/10/2026', 'Recibido: viaje', 170)], 2000);
    const income = await idOf(repo, 'Recibido: viaje');
    const concepts = async (before?: string) => (await repo.reimbursementCandidates(income, { before })).map((c) => c.transaction.bankConcept);
    expect(await concepts()).toEqual(['Tren']);
    expect(await concepts('2026-09-15')).toEqual(['Tren']);
    expect(await concepts('2026-09-14')).toEqual(['Tren', 'Hotel Playa']);

    await repo.setReimbursements(income, [{ expenseId: await idOf(repo, 'Hotel Playa'), amount: 15000 }]);
    expect(await concepts()).toEqual(['Tren', 'Hotel Playa']);
  });

  it('offers nothing for anything but an imported income', async () => {
    const { repo } = await setup();
    const { ids } = await linkedData(repo);
    expect(await repo.reimbursementCandidates(ids.romera)).toEqual([]);
    expect(await repo.reimbursementCandidates('nope')).toEqual([]);
  });
});

describe('reimbursements and backups', () => {
  it('travel in a backup and come back with a restore, counting as before', async () => {
    const source = await setup();
    const { ids } = await linkedData(source.repo);
    await linkAll(source.repo, ids);
    const backup = await source.repo.exportBackup();
    expect(backup.format).toBe(2);
    expect(backup.data.reimbursements).toHaveLength(6);

    const target = await setup();
    const read = target.repo.readBackup(backupJson(backup));
    if (!read.ok) throw new Error('Refused');
    // Five incomes paying something back.
    expect(read.summary.reimbursements).toBe(5);
    await target.repo.restoreBackup(read.backup);
    expect(await target.db.reimbursements.toArray()).toEqual(await source.db.reimbursements.toArray());
    expect(await view(target.repo, ids.romera)).toEqual(await view(source.repo, ids.romera));
    expect((await target.repo.home('2026-10')).summary).toEqual((await source.repo.home('2026-10')).summary);
    expect(await target.repo.dataCounts()).toEqual(await source.repo.dataCounts());
  });
});
