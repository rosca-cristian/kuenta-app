import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository, MonthlyView } from '../src/data/repository';
import { bbvaXlsx, type SampleFileOptions, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

/** The clock reads Tuesday 20 October 2026, as in the other repository tests. */
async function setup() {
  const repo = createDexieRepository({ name: `kuenta-monthly-test-${++dbCount}`, now: () => new Date('2026-10-20T10:00:00') });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return repo;
}

async function importFile(repo: DataRepository, movements: SampleMovement[], options: SampleFileOptions = { startBalance: 2000 }) {
  const result = await repo.previewImport(await bbvaXlsx(movements, options), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return repo.commitImport(result.preview);
}

async function transactionId(repo: DataRepository, month: string, movement: string) {
  const tx = (await repo.listTransactions(month)).find((t) => t.bankMovement === movement);
  if (!tx) throw new Error(`No transaction with movement ${movement} in ${month}`);
  return tx.id;
}

/** Each entry's month, income and expenses, oldest first. */
const bars = (view: MonthlyView) => view.entries.map((entry) => [entry.month, entry.income, entry.expenses]);

/** August to October 2026: payroll each month, groceries, and a Revolut top-up in October. */
const movements: SampleMovement[] = [
  { valor: '01/08/2026', concepto: 'Abono de nómina', movimiento: 'Nómina agosto', importe: 1500 },
  { valor: '10/08/2026', concepto: 'Mercadona', movimiento: 'Compra agosto', importe: -1700 },
  { valor: '01/09/2026', concepto: 'Abono de nómina', movimiento: 'Nómina septiembre', importe: 1500 },
  { valor: '15/09/2026', concepto: 'Mercadona', movimiento: 'Compra septiembre', importe: -400.25 },
  { valor: '01/10/2026', concepto: 'Abono de nómina', movimiento: 'Nómina octubre', importe: 1600 },
  { valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Compra octubre', importe: -80.5 },
  { valor: '09/10/2026', concepto: 'Revolut**5625*', movimiento: 'Recarga', importe: -200 },
];

describe('income and expenses by month', () => {
  it('gives each month since the data starts, ending at the current one, as Inicio sums it', async () => {
    const repo = await setup();
    await importFile(repo, movements);

    const view = await repo.monthly(6);
    // May to July have no data: the series starts in August.
    expect(bars(view)).toEqual([
      ['2026-08', 150000, 170000],
      ['2026-09', 150000, 40025],
      ['2026-10', 160000, 28050],
    ]);
    expect(view.entries.map((entry) => entry.net)).toEqual([-20000, 109975, 131950]);
    // Only the current month is still under way.
    expect(view.entries.map((entry) => entry.inProgress)).toEqual([false, false, true]);

    for (const entry of view.entries) {
      const { summary } = await repo.home(entry.month);
      expect([entry.income, entry.expenses, entry.net]).toEqual([summary.income, summary.expenses, summary.savings]);
    }
  });

  it('covers 6 or 12 months, keeping the empty months after the data starts', async () => {
    const repo = await setup();
    await importFile(repo, [{ valor: '10/03/2026', concepto: 'Mercadona', movimiento: 'Compra marzo', importe: -30 }, ...movements]);

    // Six months, May to October: March is before them, so they all show, May to July empty.
    const six = await repo.monthly(6);
    expect(six.entries.map((entry) => entry.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(bars(six).slice(0, 3)).toEqual([
      ['2026-05', 0, 0],
      ['2026-06', 0, 0],
      ['2026-07', 0, 0],
    ]);

    // Twelve months, November 2025 to October 2026: they start at March, the first with data.
    const twelve = await repo.monthly(12);
    expect(twelve.entries.map((entry) => entry.month)).toEqual(['2026-03', '2026-04', ...six.entries.map((entry) => entry.month)]);
    expect(bars(twelve)[0]).toEqual(['2026-03', 0, 3000]);
    expect(twelve.entries.slice(2)).toEqual(six.entries);
  });

  it('never counts transfers or balance adjustments, nor starts the series with them', async () => {
    const repo = await setup();
    const { id: revolut } = (await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string };
    // The file's last "Disponible" is 25 € short of the rows: the check offers an adjustment.
    const last = movements.at(-1)!;
    const outcome = await importFile(repo, [...movements.slice(0, -1), { ...last, disponible: 2000 + 1500 - 1700 + 1500 - 400.25 + 1600 - 80.5 - 200 - 25 }]);
    expect(outcome.check.difference).toBe(-2500);
    const before = await repo.monthly(6);

    await repo.createBalanceAdjustment();
    await repo.updateAccountBalance(revolut, 12345);
    expect(await repo.monthly(6)).toEqual(before);

    // The Revolut top-up was an expense; as a transfer it leaves October's expenses.
    await repo.updateTransaction(await transactionId(repo, '2026-10', 'Recarga'), { transferAccountId: revolut });
    const after = await repo.monthly(6);
    expect(bars(after).at(-1)).toEqual(['2026-10', 160000, 8050]);
    expect(after.entries.at(-1)!.expenses).toBe((await repo.home('2026-10')).summary.expenses);
  });

  it('is empty without imported transactions', async () => {
    const repo = await setup();
    expect(await repo.monthly(6)).toEqual({ entries: [] });
    // A non-imported account's balance is an adjustment: still no data.
    const { id: revolut } = (await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string };
    await repo.updateAccountBalance(revolut, 12345);
    expect(await repo.monthly(12)).toEqual({ entries: [] });
  });
});
