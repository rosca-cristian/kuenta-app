import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository, SpendingView } from '../src/data/repository';
import { bbvaXlsx, type SampleFileOptions, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

/** The clock reads Tuesday 20 October 2026, as in the other repository tests. */
async function setup() {
  const repo = createDexieRepository({ name: `kuenta-spending-test-${++dbCount}`, now: () => new Date('2026-10-20T10:00:00') });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return repo;
}

async function importFile(repo: DataRepository, movements: SampleMovement[], options: SampleFileOptions = { startBalance: 2000 }) {
  const result = await repo.previewImport(await bbvaXlsx(movements, options), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return repo.commitImport(result.preview);
}

async function categoryId(repo: DataRepository, name: string) {
  const category = (await repo.listCategories()).find((c) => c.name === name);
  if (!category) throw new Error(`No category named ${name}`);
  return category.id;
}

async function transactionId(repo: DataRepository, month: string, movement: string) {
  const tx = (await repo.listTransactions(month)).find((t) => t.bankMovement === movement);
  if (!tx) throw new Error(`No transaction with movement ${movement} in ${month}`);
  return tx.id;
}

/** Each entry's name ("Sin categoría" for none) and amount, in the order shown. */
const amounts = (view: SpendingView) => view.entries.map((entry) => [entry.category?.name ?? 'Sin categoría', entry.amount]);

/**
 * September and October 2026. The starter rules make Mercadona Supermercado, Glovo
 * Restaurantes and the payroll Nómina; the Bizums and the shop stay uncategorized.
 */
const movements: SampleMovement[] = [
  { valor: '15/09/2026', concepto: 'Mercadona', movimiento: 'Septiembre', importe: -40 },
  { valor: '01/10/2026', concepto: 'Abono de nómina', movimiento: 'Nómina octubre', importe: 1500 },
  { valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Compra 1', importe: -80.5 },
  { valor: '03/10/2026', concepto: 'Glovo', movimiento: 'Cena', importe: -60 },
  { valor: '04/10/2026', concepto: 'Bizum recibido', movimiento: 'Parte de la cena', importe: 20 },
  { valor: '06/10/2026', concepto: 'Mercadona', movimiento: 'Compra 2', importe: -19.5 },
  { valor: '07/10/2026', concepto: 'Tienda de barrio', movimiento: 'Sin categoría 1', importe: -15 },
  { valor: '08/10/2026', concepto: 'Bizum recibido', movimiento: 'Sin categoría 2', importe: 30 },
  { valor: '09/10/2026', concepto: 'Revolut**5625*', movimiento: 'Recarga', importe: -200 },
];

describe('spending by category', () => {
  it('lists each category with spending, highest first, whose amounts and percentages add up to the total', async () => {
    const repo = await setup();
    await importFile(repo, movements);
    // The Bizum for the shared dinner, categorized as Restaurantes, takes it down to 40 €.
    await repo.updateTransaction(await transactionId(repo, '2026-10', 'Parte de la cena'), { categoryId: await categoryId(repo, 'Restaurantes') });

    const view = await repo.spending('2026-10');
    // The uncategorized Bizum received doesn't reduce "Sin categoría": it's expenses only.
    expect(amounts(view)).toEqual([
      ['Sin categoría', 21500],
      ['Supermercado', 10000],
      ['Restaurantes', 4000],
    ]);
    expect(view.total).toBe(35500);
    expect(view.entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(view.total);
    expect(view.entries.reduce((sum, entry) => sum + entry.percent, 0)).toBeCloseTo(100);
    expect(view.entries[1].percent).toBeCloseTo((10000 * 100) / 35500);
    // Slices take each category's colour; "Sin categoría" has none.
    expect(view.entries.map((entry) => entry.category?.color ?? null)).toEqual([null, 'green', 'orange']);
    // Payroll is income: Nómina's net is negative, so it's left out.
    expect(amounts(view).map(([name]) => name)).not.toContain('Nómina');
    // Another month only counts its own transactions, by date.
    expect(amounts(await repo.spending('2026-09'))).toEqual([['Supermercado', 4000]]);
  });

  it('leaves out a category whose income is at least its expenses', async () => {
    const repo = await setup();
    await importFile(repo, movements);
    const restaurantes = await categoryId(repo, 'Restaurantes');
    // Friends paid back 50 € of the 60 € dinner: 10 € spent.
    await repo.updateTransaction(await transactionId(repo, '2026-10', 'Parte de la cena'), { categoryId: restaurantes });
    await repo.updateTransaction(await transactionId(repo, '2026-10', 'Sin categoría 2'), { categoryId: restaurantes });
    expect(amounts(await repo.spending('2026-10'))).toContainEqual(['Restaurantes', 1000]);

    // The payroll put in Restaurantes by mistake: more came in than went out, so it's left out.
    await repo.updateTransaction(await transactionId(repo, '2026-10', 'Nómina octubre'), { categoryId: restaurantes });
    const view = await repo.spending('2026-10');
    expect(amounts(view)).toEqual([
      ['Sin categoría', 21500],
      ['Supermercado', 10000],
    ]);
    expect(view.total).toBe(31500);
  });

  it('agrees with the budgets view for a budgeted category', async () => {
    const repo = await setup();
    await importFile(repo, movements);
    const restaurantes = await categoryId(repo, 'Restaurantes');
    await repo.setBudgetLimit(restaurantes, 30000, '2026-09');
    await repo.updateTransaction(await transactionId(repo, '2026-10', 'Parte de la cena'), { categoryId: restaurantes });

    const budget = (await repo.budgets('2026-10')).budgets.find((b) => b.category.id === restaurantes);
    const entry = (await repo.spending('2026-10')).entries.find((e) => e.category?.id === restaurantes);
    expect(budget?.spent).toBe(4000);
    expect(entry?.amount).toBe(budget?.spent);
  });

  it('never counts transfers or balance adjustments', async () => {
    const repo = await setup();
    const { id: revolut } = (await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string };
    // The file's last "Disponible" is 25 € short of the rows: the check offers an adjustment.
    const last = movements.at(-1)!;
    const outcome = await importFile(repo, [...movements.slice(0, -1), { ...last, disponible: 2000 - 40 + 1500 - 80.5 - 60 + 20 - 19.5 - 15 + 30 - 200 - 25 }]);
    expect(outcome.check.difference).toBe(-2500);
    const before = await repo.spending('2026-10');

    await repo.createBalanceAdjustment();
    await repo.updateAccountBalance(revolut, 12345);
    expect(await repo.spending('2026-10')).toEqual(before);

    // The Revolut top-up was an uncategorized expense; as a transfer it leaves "Sin categoría".
    await repo.updateTransaction(await transactionId(repo, '2026-10', 'Recarga'), { transferAccountId: revolut });
    const after = await repo.spending('2026-10');
    expect(amounts(after)).toEqual([
      ['Supermercado', 10000],
      ['Restaurantes', 6000],
      ['Sin categoría', 1500],
    ]);
    expect(after.total).toBe(17500);
  });

  it('is empty for a month without spending', async () => {
    const repo = await setup();
    await importFile(repo, movements);
    expect(await repo.spending('2026-08')).toEqual({ entries: [], total: 0 });
  });
});

describe('filtering Movimientos', () => {
  const movementsOf = async (repo: DataRepository, ...args: Parameters<DataRepository['listTransactions']>) =>
    (await repo.listTransactions(...args)).map((tx) => tx.bankMovement);

  it('shows a month’s transactions of one category, newest first', async () => {
    const repo = await setup();
    await importFile(repo, movements);
    const supermercado = await categoryId(repo, 'Supermercado');

    expect(await movementsOf(repo, '2026-10', { categoryId: supermercado })).toEqual(['Compra 2', 'Compra 1']);
    expect(await movementsOf(repo, '2026-09', { categoryId: supermercado })).toEqual(['Septiembre']);
    // Without a filter, the whole month.
    expect(await movementsOf(repo, '2026-10')).toHaveLength(8);
    expect(await movementsOf(repo, '2026-10', {})).toHaveLength(8);
  });

  it('shows "sin categoría": uncategorized expenses and income, not transfers or adjustments', async () => {
    const repo = await setup();
    const { id: revolut } = (await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string };
    await importFile(repo, movements);
    await repo.updateAccountBalance(revolut, 12345);
    await repo.updateTransaction(await transactionId(repo, '2026-10', 'Recarga'), { transferAccountId: revolut });

    expect(await movementsOf(repo, '2026-10', { categoryId: null })).toEqual(['Sin categoría 2', 'Sin categoría 1', 'Parte de la cena']);
    // Inicio's alert counts the same transactions.
    expect((await repo.home('2026-10')).uncategorized).toBe(3);
  });

  it('counts on Inicio only the month shown, as the list its alert opens', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '15/09/2026', concepto: 'Tienda de barrio', movimiento: 'Septiembre 1', importe: -10 },
      { valor: '16/09/2026', concepto: 'Tienda de barrio', movimiento: 'Septiembre 2', importe: -12 },
      { valor: '05/10/2026', concepto: 'Mercadona', movimiento: 'Octubre', importe: -30 },
    ]);

    expect((await repo.home('2026-10')).uncategorized).toBe(0);
    expect(await movementsOf(repo, '2026-10', { categoryId: null })).toEqual([]);
    expect((await repo.home('2026-09')).uncategorized).toBe(2);
    expect(await movementsOf(repo, '2026-09', { categoryId: null })).toHaveLength(2);
  });

  it('shows a payee’s transactions, alone or with a category', async () => {
    const repo = await setup();
    await importFile(repo, movements);
    // Imports name the payee after the concept; two of the three Mercadona rows go to another one.
    await repo.updateTransaction(await transactionId(repo, '2026-10', 'Compra 1'), { payeeName: 'Mercadona Centro' });
    await repo.updateTransaction(await transactionId(repo, '2026-09', 'Septiembre'), { payeeName: 'Mercadona Centro' });
    const mercadona = (await repo.listPayees()).find((payee) => payee.name === 'Mercadona Centro')!.id;

    expect(await movementsOf(repo, '2026-10', { payeeId: mercadona })).toEqual(['Compra 1']);
    expect(await movementsOf(repo, '2026-09', { payeeId: mercadona })).toEqual(['Septiembre']);
    expect(await movementsOf(repo, '2026-10', { payeeId: mercadona, categoryId: await categoryId(repo, 'Supermercado') })).toEqual(['Compra 1']);
    expect(await movementsOf(repo, '2026-10', { payeeId: mercadona, categoryId: await categoryId(repo, 'Restaurantes') })).toEqual([]);
  });
});
