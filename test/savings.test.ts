import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import { KuentaDb } from '../src/data/dexie/db';
import type { DataRepository, SavingsView } from '../src/data/repository';
import type { SampleMovement } from './support/bbvaXlsx';
import { importFile } from './support/backupData';

let dbCount = 0;

/** An onboarded repository on its own database, whose clock reads Tuesday 10 November 2026 and can move on. */
async function setup() {
  const name = `kuenta-savings-test-${++dbCount}`;
  const clock = { now: new Date('2026-11-10T10:00:00') };
  const repo = createDexieRepository({ name, now: () => clock.now, appVersion: '1.2.3' });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return { name, repo, clock, db: new KuentaDb(name) };
}

const card = (valor: string, concepto: string, importe: number): SampleMovement => ({ valor, concepto, movimiento: 'Pago con tarjeta', importe });
const salary = (valor: string, importe: number): SampleMovement => ({ valor, concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe });

/**
 * Groceries in September; the salary paid on the 29th of September and of October, for the
 * month after; a dinner a friend pays back part of by Bizum, and a top-up to Revolut in October;
 * groceries in November. The starter rules make the salaries Nómina and the groceries Supermercado.
 */
const movements: SampleMovement[] = [
  card('10/09/2026', 'Mercadona', -50),
  salary('29/09/2026', 1500),
  card('05/10/2026', 'Mercadona', -60),
  card('10/10/2026', 'Bar Romera', -73.5),
  { valor: '11/10/2026', concepto: 'Bizum', movimiento: 'Recibido: Ana cena', importe: 38.05 },
  salary('29/10/2026', 1600),
  card('30/10/2026', 'Revolut**5625*', -200),
  card('03/11/2026', 'Mercadona', -20),
];

async function idOf(repo: DataRepository, text: string) {
  const tx = (await repo.listTransactions(null)).find((t) => t.bankConcept === text || t.note === text);
  if (!tx) throw new Error(`No transaction ${text}`);
  return tx.id;
}

async function categoryId(repo: DataRepository, name: string) {
  return (await repo.listCategories()).find((c) => c.name === name)!.id;
}

/** The movements imported, Nómina counting from the 25th in the next month, Ana's Bizum paying back her part of the dinner and the top-up a transfer to Revolut. */
async function monthsOfData(repo: DataRepository) {
  await importFile(repo, movements, 2000);
  await repo.updateCategory(await categoryId(repo, 'Nómina'), { nextMonthFromDay: 25 });
  await repo.setReimbursements(await idOf(repo, 'Recibido: Ana cena'), [{ expenseId: await idOf(repo, 'Bar Romera'), amount: 3805 }]);
  const revolut = await repo.createAccount({ name: 'Revolut', type: 'savings', icon: 'piggy-bank', color: 'cyan' });
  if (!revolut.ok) throw new Error('No Revolut');
  await repo.updateTransaction(await idOf(repo, 'Revolut**5625*'), { transferAccountId: revolut.id });
}

const targetIn = async (repo: DataRepository, month: string) => (await repo.savings(month)).target;

/** The view of a month with a target. */
async function withTarget(repo: DataRepository, month: string) {
  const view: SavingsView = await repo.savings(month);
  if (view.target === null) throw new Error(`No target in ${month}`);
  return view;
}

describe('setting the monthly savings target', () => {
  it('sets it from the current month on, with nothing before it', async () => {
    const { repo } = await setup();
    expect(await repo.savings('2026-11')).toEqual({ target: null });

    await repo.setSavingsTarget(30000);

    expect(await withTarget(repo, '2026-11')).toMatchObject({ month: '2026-11', target: 30000, saved: 0, percent: 0, status: 'inProgress', reached: false });
    expect(await targetIn(repo, '2027-06')).toBe(30000);
    expect(await targetIn(repo, '2026-10')).toBeNull();
  });

  it('replaces the target from a month on, deleting the later ones, and removing it keeps earlier months', async () => {
    const { repo, db } = await setup();
    await repo.setSavingsTarget(30000, '2026-09');
    await repo.setSavingsTarget(25000, '2026-12');
    expect(await targetIn(repo, '2026-11')).toBe(30000);
    expect(await targetIn(repo, '2027-01')).toBe(25000);

    await repo.setSavingsTarget(28000, '2026-10');
    expect(await targetIn(repo, '2026-09')).toBe(30000);
    expect(await targetIn(repo, '2026-10')).toBe(28000);
    expect(await targetIn(repo, '2027-01')).toBe(28000);
    expect((await db.savingsTargets.toArray()).map((row) => [row.fromMonth, row.amount]).sort()).toEqual([
      ['2026-09', 30000],
      ['2026-10', 28000],
    ]);

    // Changed again in October, the row starting then is replaced.
    await repo.setSavingsTarget(29000, '2026-10');
    expect(await db.savingsTargets.count()).toBe(2);

    await repo.setSavingsTarget(0);
    expect(await targetIn(repo, '2026-11')).toBeNull();
    expect(await targetIn(repo, '2027-01')).toBeNull();
    expect(await targetIn(repo, '2026-10')).toBe(29000);
  });

  it('refuses a negative amount, one that is not whole cents and a month that is not one, saving nothing', async () => {
    const { repo, db } = await setup();
    await expect(repo.setSavingsTarget(-100)).rejects.toThrow();
    await expect(repo.setSavingsTarget(100.5)).rejects.toThrow();
    await expect(repo.setSavingsTarget(30000, '2026-13')).rejects.toThrow();
    expect(await db.savingsTargets.count()).toBe(0);
  });

  it('records a change only when the target differs', async () => {
    const { repo, clock, db } = await setup();
    let notified = 0;
    repo.subscribe(() => notified++);
    const lastChangeAt = async () => (await db.settings.get('lastChangeAt'))?.value;

    // Removing a target when there's none changes nothing.
    await repo.setSavingsTarget(0);
    expect(notified).toBe(0);
    expect(await lastChangeAt()).toBeUndefined();

    await repo.setSavingsTarget(30000, '2026-10');
    expect(notified).toBe(1);
    expect(await lastChangeAt()).toBe(clock.now.toISOString());

    // The same target again, from its month or a later one, is no change.
    clock.now = new Date('2026-11-10T11:00:00');
    await repo.setSavingsTarget(30000, '2026-10');
    await repo.setSavingsTarget(30000);
    expect(notified).toBe(1);
    expect(await lastChangeAt()).toBe(new Date('2026-11-10T10:00:00').toISOString());
    expect(await db.savingsTargets.count()).toBe(1);

    await repo.setSavingsTarget(32000);
    expect(notified).toBe(2);
    expect(await lastChangeAt()).toBe(clock.now.toISOString());

    clock.now = new Date('2026-11-10T12:00:00');
    await repo.setSavingsTarget(0, '2026-10');
    expect(notified).toBe(3);
    expect(await lastChangeAt()).toBe(clock.now.toISOString());
  });
});

describe("a month's savings", () => {
  it("are Inicio's month savings, with a reimbursement and a salary counting in the next month", async () => {
    const { repo } = await setup();
    await monthsOfData(repo);
    await repo.setSavingsTarget(30000, '2026-09');

    for (const month of ['2026-09', '2026-10', '2026-11']) {
      expect((await withTarget(repo, month)).saved, month).toBe((await repo.home(month)).summary.savings);
    }
    // September keeps only its groceries; October gets September's salary and counts only my part of the dinner,
    // November October's salary.
    expect((await withTarget(repo, '2026-09')).saved).toBe(-5000);
    expect((await withTarget(repo, '2026-10')).saved).toBe(150000 - 6000 - (7350 - 3805));
    expect((await withTarget(repo, '2026-11')).saved).toBe(160000 - 2000);
  });

  it('never count transfers to my own accounts as spending', async () => {
    const { repo } = await setup();
    await importFile(repo, movements, 2000);
    await repo.setSavingsTarget(30000, '2026-09');
    const before = (await withTarget(repo, '2026-10')).saved;

    const revolut = await repo.createAccount({ name: 'Revolut', type: 'savings', icon: 'piggy-bank', color: 'cyan' });
    if (!revolut.ok) throw new Error('No Revolut');
    await repo.updateTransaction(await idOf(repo, 'Revolut**5625*'), { transferAccountId: revolut.id });

    expect((await withTarget(repo, '2026-10')).saved).toBe(before + 20000);
    expect((await withTarget(repo, '2026-10')).saved).toBe((await repo.home('2026-10')).summary.savings);
  });

  it('carry the "today" marker in the current month only', async () => {
    const { repo } = await setup();
    await repo.setSavingsTarget(30000, '2026-10');
    expect((await withTarget(repo, '2026-11')).today).toBe(10 / 30);
    expect((await withTarget(repo, '2026-10')).today).toBeNull();
  });
});

describe('the history and the streak', () => {
  it('judge each month against the target it had, from the first month with data, the current one in progress', async () => {
    const { repo } = await setup();
    await monthsOfData(repo);
    // Set in August, before any data: August is left out.
    await repo.setSavingsTarget(30000, '2026-08');

    let view = await withTarget(repo, '2026-11');
    expect(view.history.map((entry) => [entry.month, entry.target, entry.status])).toEqual([
      ['2026-11', 30000, 'inProgress'],
      ['2026-10', 30000, 'met'],
      ['2026-09', 30000, 'missed'],
    ]);
    expect(view.streak).toBe(1);

    // Raised from November, October keeps its 300 € and stays met.
    await repo.setSavingsTarget(200000);
    view = await withTarget(repo, '2026-11');
    expect(view).toMatchObject({ target: 200000, saved: 158000, reached: false });
    expect(view.history.map((entry) => [entry.month, entry.target, entry.status])).toEqual([
      ['2026-11', 200000, 'inProgress'],
      ['2026-10', 30000, 'met'],
      ['2026-09', 30000, 'missed'],
    ]);
    expect(view.streak).toBe(1);
  });

  it('are empty without data', async () => {
    const { repo } = await setup();
    await repo.setSavingsTarget(30000);
    expect(await withTarget(repo, '2026-11')).toMatchObject({ history: [], streak: 0 });
  });
});

describe('restoring a backup', () => {
  it('leaves no monthly savings target, which backups do not carry yet', async () => {
    const { repo } = await setup();
    await monthsOfData(repo);
    await repo.setSavingsTarget(30000);
    const backup = await repo.exportBackup();
    expect(Object.keys(backup.data)).not.toContain('savingsTargets');

    await repo.restoreBackup(backup);
    expect(await repo.savings('2026-11')).toEqual({ target: null });
    await repo.setSavingsTarget(30000);
    expect(await targetIn(repo, '2026-11')).toBe(30000);
  });
});
