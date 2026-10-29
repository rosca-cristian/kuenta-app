import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository, MonthlyView } from '../src/data/repository';
import { backupJson } from '../src/domain/backup';
import type { SampleMovement } from './support/bbvaXlsx';
import { importFile } from './support/backupData';

let dbCount = 0;

/** An onboarded repository on its own database, whose clock reads Tuesday 10 November 2026. */
async function setup() {
  const repo = createDexieRepository({ name: `kuenta-counting-month-test-${++dbCount}`, now: () => new Date('2026-11-10T10:00:00'), appVersion: '1.2.3' });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return repo;
}

const card = (valor: string, concepto: string, importe: number): SampleMovement => ({ valor, concepto, movimiento: 'Pago con tarjeta', importe });
const salary = (valor: string, importe: number): SampleMovement => ({ valor, concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe });

/**
 * The salary paid on the 29th of September and of October, for the month after, with the
 * groceries of each month around it, one on the 30th. The starter rules make them Nómina and
 * Supermercado.
 */
const movements: SampleMovement[] = [
  salary('29/09/2026', 1500),
  card('05/10/2026', 'Mercadona', -60),
  salary('29/10/2026', 1600),
  card('30/10/2026', 'Mercadona', -40),
  card('03/11/2026', 'Mercadona', -20),
];

async function categoryId(repo: DataRepository, name: string) {
  return (await repo.listCategories()).find((c) => c.name === name)!.id;
}

/** The movements imported, with Nómina counting from the 25th in the next month. */
async function lateSalaries() {
  const repo = await setup();
  await importFile(repo, movements, 2000);
  const nomina = await categoryId(repo, 'Nómina');
  await repo.updateCategory(nomina, { nextMonthFromDay: 25 });
  return { repo, nomina };
}

const bars = (view: MonthlyView) => view.entries.map((entry) => [entry.month, entry.income, entry.expenses]);

describe('a salary that arrives late in the month', () => {
  it('counts on Inicio in the month after its date, from the day set', async () => {
    const repo = await setup();
    await importFile(repo, movements, 2000);
    // Off, as every category starts: each salary counts in its own month.
    expect((await repo.home('2026-10')).summary).toMatchObject({ income: 160000, expenses: 10000 });
    const balanceBefore = (await repo.home('2026-10')).totalBalance;

    await repo.updateCategory(await categoryId(repo, 'Nómina'), { nextMonthFromDay: 25 });
    expect((await repo.home('2026-09')).summary).toMatchObject({ income: 0, expenses: 0, savingsRate: null });
    expect((await repo.home('2026-10')).summary).toEqual({ income: 150000, expenses: 10000, savings: 140000, savingsRate: 140000 / 150000 });
    expect((await repo.home('2026-11')).summary).toMatchObject({ income: 160000, expenses: 2000 });
    // Balances keep the bank's dates: nothing changes there.
    const home = await repo.home('2026-10');
    expect(home.totalBalance).toBe(balanceBefore);
    expect(home.accounts[0].balance).toBe(balanceBefore);
    expect(home.uncategorized).toBe(0);

    // Turned off again, they're back in their own months.
    await repo.updateCategory(await categoryId(repo, 'Nómina'), { nextMonthFromDay: null });
    expect((await repo.home('2026-10')).summary).toMatchObject({ income: 160000, expenses: 10000 });
  });

  it('counts in Análisis → Mensual in the month after, the series starting where something counts', async () => {
    const { repo } = await lateSalaries();
    // September only has a salary that counts in October, so the series starts in October.
    const view = await repo.monthly(6);
    expect(bars(view)).toEqual([
      ['2026-10', 150000, 10000],
      ['2026-11', 160000, 2000],
    ]);
    for (const entry of view.entries) {
      const { summary } = await repo.home(entry.month);
      expect([entry.income, entry.expenses, entry.net]).toEqual([summary.income, summary.expenses, summary.savings]);
    }
  });

  it("leaves out a late salary of the current month until its month comes, and an older one's month out of range", async () => {
    const repo = await setup();
    await importFile(repo, [card('03/11/2026', 'Mercadona', -20), salary('27/11/2026', 1700)], 2000);
    await repo.updateCategory(await categoryId(repo, 'Nómina'), { nextMonthFromDay: 25 });
    // On 10 November a salary dated the 27th (a value date can be ahead) counts in December, not shown yet.
    expect(bars(await repo.monthly(6))).toEqual([['2026-11', 0, 2000]]);
    expect((await repo.home('2026-12')).summary).toMatchObject({ income: 170000, expenses: 0 });

    // Six months from June: May's late salary counts in June, the first month shown.
    const older = await setup();
    await importFile(older, [salary('28/05/2026', 1500), card('03/11/2026', 'Mercadona', -20)], 2000);
    await older.updateCategory(await categoryId(older, 'Nómina'), { nextMonthFromDay: 25 });
    expect(bars(await older.monthly(6))[0]).toEqual(['2026-06', 150000, 0]);
  });

  it("doesn't move expenses: spending and budgets count them in their own month", async () => {
    const { repo } = await lateSalaries();
    const supermercado = await categoryId(repo, 'Supermercado');
    await repo.setBudgetLimit(supermercado, 30000, '2026-10');

    const october = await repo.spending('2026-10');
    expect(october.entries.map((entry) => [entry.category?.name, entry.amount])).toEqual([['Supermercado', 10000]]);
    expect((await repo.budgets('2026-10')).budgets).toMatchObject([{ category: { name: 'Supermercado' }, spent: 10000 }]);
    expect((await repo.budgets('2026-11')).budgets).toMatchObject([{ category: { name: 'Supermercado' }, spent: 2000 }]);
    // Nómina only brings money in: it never has spending to show.
    expect((await repo.spending('2026-11')).entries.map((entry) => entry.category?.name)).toEqual(['Supermercado']);
  });

  it('counts an income in an expense category in its own month, even with a day set', async () => {
    const { repo } = await lateSalaries();
    const supermercado = await categoryId(repo, 'Supermercado');
    await repo.updateCategory(supermercado, { nextMonthFromDay: 1 });
    await importFile(repo, [card('31/10/2026', 'Mercadona devolucion', 15)], 2000);
    const refund = (await repo.listTransactions('2026-10')).find((tx) => tx.bankConcept === 'Mercadona devolucion')!;
    await repo.updateTransaction(refund.id, { categoryId: supermercado });

    expect((await repo.spending('2026-10')).entries.map((entry) => [entry.category?.name, entry.amount])).toEqual([['Supermercado', 8500]]);
    expect((await repo.getTransaction(refund.id))!.countingMonth).toBeNull();
  });

  it('stays in Movimientos on its date, saying the month it counts in', async () => {
    const { repo } = await lateSalaries();
    const october = await repo.listTransactions('2026-10');
    expect(october.map((tx) => [tx.date, tx.bankConcept, tx.countingMonth])).toEqual([
      ['2026-10-30', 'Mercadona', null],
      ['2026-10-29', 'Abono de nómina', '2026-11'],
      ['2026-10-05', 'Mercadona', null],
    ]);
    expect((await repo.listTransactions('2026-11')).map((tx) => tx.bankConcept)).toEqual(['Mercadona']);
    expect((await repo.listTransactions('2026-09')).map((tx) => tx.countingMonth)).toEqual(['2026-10']);
  });

  it('counts what a salary keeps after paying back an expense in its counting month', async () => {
    const { repo } = await lateSalaries();
    const october = await repo.listTransactions('2026-10');
    const salaryId = october.find((tx) => tx.type === 'income')!.id;
    const shopId = october.find((tx) => tx.date === '2026-10-30')!.id;
    await repo.setReimbursements(salaryId, [{ expenseId: shopId, amount: 1000 }]);

    // The expense is smaller in its own month; the salary keeps the rest, in November.
    expect((await repo.home('2026-10')).summary).toMatchObject({ income: 150000, expenses: 9000 });
    expect((await repo.home('2026-11')).summary).toMatchObject({ income: 159000, expenses: 2000 });
    expect(bars(await repo.monthly(6))).toEqual([
      ['2026-10', 150000, 9000],
      ['2026-11', 159000, 2000],
    ]);
  });
});

describe('the setting of a category', () => {
  it('starts off on the starter categories and new ones', async () => {
    const repo = await setup();
    expect((await repo.listCategories()).every((category) => category.nextMonthFromDay === null)).toBe(true);
    const created = await repo.createCategory({ name: 'Pensión', kind: 'income', icon: 'briefcase', color: 'green' });
    const withDay = await repo.createCategory({ name: 'Extra', kind: 'income', icon: 'briefcase', color: 'green', nextMonthFromDay: 28 });
    const categories = await repo.listCategories();
    expect(categories.find((c) => c.id === (created as { id: string }).id)!.nextMonthFromDay).toBeNull();
    expect(categories.find((c) => c.id === (withDay as { id: string }).id)!.nextMonthFromDay).toBe(28);
  });

  it('is refused, changing nothing, when the day is not from 1 to 31', async () => {
    const repo = await setup();
    const nomina = await categoryId(repo, 'Nómina');
    for (const day of [0, 32, 2.5]) await expect(repo.updateCategory(nomina, { nextMonthFromDay: day })).rejects.toThrow();
    await expect(repo.createCategory({ name: 'Extra', kind: 'income', icon: 'briefcase', color: 'green', nextMonthFromDay: 40 })).rejects.toThrow();
    expect((await repo.listCategories()).find((c) => c.id === nomina)!.nextMonthFromDay).toBeNull();
    expect((await repo.listCategories()).some((c) => c.name === 'Extra')).toBe(false);
  });
});

describe('the setting in backups', () => {
  it('goes in the copy and comes back on restore', async () => {
    const { repo, nomina } = await lateSalaries();
    const backup = await repo.exportBackup();
    expect(backup.data.categories.find((c) => c.id === nomina)!.nextMonthFromDay).toBe(25);

    const target = await setup();
    const read = target.readBackup(backupJson(backup));
    if (!read.ok) throw new Error('The backup should read');
    await target.restoreBackup(read.backup);
    expect((await target.listCategories()).find((c) => c.id === nomina)!.nextMonthFromDay).toBe(25);
    expect((await target.home('2026-11')).summary).toMatchObject({ income: 160000, expenses: 2000 });
  });

  it('is off for the categories of a copy made before it', async () => {
    const { repo, nomina } = await lateSalaries();
    const file = JSON.parse(backupJson(await repo.exportBackup()));
    for (const category of file.data.categories) delete category.nextMonthFromDay;

    const target = await setup();
    const read = target.readBackup(JSON.stringify(file));
    if (!read.ok) throw new Error('The backup should read');
    expect(read.backup.data.categories.every((category) => category.nextMonthFromDay === null)).toBe(true);
    await target.restoreBackup(read.backup);
    expect((await target.listCategories()).find((c) => c.id === nomina)!.nextMonthFromDay).toBeNull();
    expect((await target.home('2026-10')).summary).toMatchObject({ income: 160000 });
  });

  it('refuses a copy whose day is not from 1 to 31', async () => {
    const { repo } = await lateSalaries();
    const file = JSON.parse(backupJson(await repo.exportBackup()));
    file.data.categories[0].nextMonthFromDay = 0;
    expect(repo.readBackup(JSON.stringify(file))).toMatchObject({ ok: false, error: { reason: 'damaged' } });
  });
});
