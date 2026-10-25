import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

/** The clock reads Tuesday 20 October 2026, as in the other repository tests. */
async function setup(now = () => new Date('2026-10-20T10:00:00')) {
  const repo = createDexieRepository({ name: `kuenta-budgets-test-${++dbCount}`, now });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return repo;
}

async function importFile(repo: DataRepository, movements: SampleMovement[]) {
  const result = await repo.previewImport(await bbvaXlsx(movements, { startBalance: 2000 }), 'movimientos.xlsx');
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

/** Imports one purchase per category on `date`, each categorized by hand. */
async function spend(repo: DataRepository, spending: [string, number][], date = '02/10/2026') {
  await importFile(
    repo,
    spending.map(([name, importe]) => ({ valor: date, concepto: 'Tienda', movimiento: name, importe })),
  );
  const month = `${date.slice(6)}-${date.slice(3, 5)}`;
  for (const [name] of spending) {
    await repo.updateTransaction(await transactionId(repo, month, name), { categoryId: await categoryId(repo, name) });
  }
}

/** Each budgeted category's name and limit in a month, in category order. */
const limitsIn = async (repo: DataRepository, month: string) =>
  Object.fromEntries((await repo.budgets(month)).budgets.map((budget) => [budget.category.name, budget.limit]));

const budgetOf = async (repo: DataRepository, month: string, name: string) =>
  (await repo.budgets(month)).budgets.find((budget) => budget.category.name === name);

describe('adding a budget', () => {
  it('sets a limit from the current month on, which the month shows with nothing spent yet', async () => {
    const repo = await setup();
    const restaurantes = await categoryId(repo, 'Restaurantes');
    expect((await repo.budgets('2026-10')).budgets).toEqual([]);

    await repo.setBudgetLimit(restaurantes, 30000);

    const october = await repo.budgets('2026-10');
    expect(october.budgets).toEqual([
      { category: expect.objectContaining({ id: restaurantes, name: 'Restaurantes' }), limit: 30000, spent: 0, percent: 0, status: 'onTrack' },
    ]);
    expect(october.totals).toEqual({ budgeted: 30000, spent: 0, remaining: 30000 });
    expect(await limitsIn(repo, '2027-03')).toEqual({ Restaurantes: 30000 });
    // From the current month: September had no budget.
    expect(await limitsIn(repo, '2026-09')).toEqual({});
  });

  it('offers only the non-archived expense categories without a budget that month', async () => {
    const repo = await setup();
    const expenseNames = (await repo.listCategories()).filter((c) => c.kind === 'expense').map((c) => c.name);
    await repo.setBudgetLimit(await categoryId(repo, 'Restaurantes'), 30000);

    const available = (await repo.budgetableCategories('2026-10')).map((c) => c.name);
    expect(available).toEqual(expenseNames.filter((name) => name !== 'Restaurantes'));
    expect(available).not.toContain('Nómina');
    // September had no budget on Restaurantes yet.
    expect((await repo.budgetableCategories('2026-09')).map((c) => c.name)).toContain('Restaurantes');
  });

  it('refuses income categories, unknown categories and negative or fractional amounts, saving nothing', async () => {
    const repo = await setup();
    const restaurantes = await categoryId(repo, 'Restaurantes');

    await expect(repo.setBudgetLimit(await categoryId(repo, 'Nómina'), 30000)).rejects.toThrow();
    await expect(repo.setBudgetLimit('no-such-category', 30000)).rejects.toThrow();
    await expect(repo.setBudgetLimit(restaurantes, -100)).rejects.toThrow();
    await expect(repo.setBudgetLimit(restaurantes, 12.5)).rejects.toThrow();

    expect((await repo.budgets('2026-10')).budgets).toEqual([]);
    expect((await repo.budgetableCategories('2026-10')).map((c) => c.name)).toContain('Restaurantes');
  });
});

describe('limits over time', () => {
  it('uses the limit with the latest starting month up to each month', async () => {
    const repo = await setup();
    const restaurantes = await categoryId(repo, 'Restaurantes');

    await repo.setBudgetLimit(restaurantes, 30000, '2026-09');
    await repo.setBudgetLimit(restaurantes, 25000, '2026-11');

    expect(await limitsIn(repo, '2026-08')).toEqual({});
    expect(await limitsIn(repo, '2026-09')).toEqual({ Restaurantes: 30000 });
    expect(await limitsIn(repo, '2026-10')).toEqual({ Restaurantes: 30000 });
    expect(await limitsIn(repo, '2026-11')).toEqual({ Restaurantes: 25000 });
    expect(await limitsIn(repo, '2026-12')).toEqual({ Restaurantes: 25000 });
  });

  it('replaces every later limit when set from a month, and removing it keeps earlier months', async () => {
    const repo = await setup();
    const restaurantes = await categoryId(repo, 'Restaurantes');
    await repo.setBudgetLimit(restaurantes, 30000, '2026-09');
    await repo.setBudgetLimit(restaurantes, 25000, '2026-11');

    await repo.setBudgetLimit(restaurantes, 28000, '2026-09');
    for (const month of ['2026-09', '2026-10', '2026-11', '2026-12']) expect(await limitsIn(repo, month)).toEqual({ Restaurantes: 28000 });

    // A 0 limit from October removes the budget from then on.
    await repo.setBudgetLimit(restaurantes, 0, '2026-10');
    expect(await limitsIn(repo, '2026-09')).toEqual({ Restaurantes: 28000 });
    expect(await limitsIn(repo, '2026-10')).toEqual({});
    expect(await limitsIn(repo, '2026-12')).toEqual({});
    expect((await repo.budgetableCategories('2026-10')).map((c) => c.name)).toContain('Restaurantes');
  });

  it('changes a limit from the selected month on, leaving the month before as it was', async () => {
    const repo = await setup();
    const restaurantes = await categoryId(repo, 'Restaurantes');
    await repo.setBudgetLimit(restaurantes, 30000, '2026-09');

    // Editing the October card "a partir de octubre 2026".
    await repo.setBudgetLimit(restaurantes, 35000, '2026-10');

    const september = await repo.budgets('2026-09');
    expect(september.budgets.map((budget) => budget.limit)).toEqual([30000]);
    expect(september.today).toBeNull();
    expect(await limitsIn(repo, '2026-10')).toEqual({ Restaurantes: 35000 });
    expect(await limitsIn(repo, '2027-01')).toEqual({ Restaurantes: 35000 });
  });

  it('adds a budget in a past month from that month on, replacing the later limits', async () => {
    const repo = await setup();
    const restaurantes = await categoryId(repo, 'Restaurantes');
    await repo.setBudgetLimit(restaurantes, 30000, '2026-10');
    // In August Restaurantes had no budget, so "Añadir presupuesto" offers it there.
    expect((await repo.budgetableCategories('2026-08')).map((c) => c.name)).toContain('Restaurantes');

    await repo.setBudgetLimit(restaurantes, 20000, '2026-08');

    expect(await limitsIn(repo, '2026-07')).toEqual({});
    for (const month of ['2026-08', '2026-09', '2026-10', '2026-11']) expect(await limitsIn(repo, month)).toEqual({ Restaurantes: 20000 });
    expect((await repo.budgetableCategories('2026-08')).map((c) => c.name)).not.toContain('Restaurantes');
  });

  it('removes the budget of a category later made an income one, but sets no new limit on it', async () => {
    const repo = await setup();
    const regalos = await categoryId(repo, 'Regalos');
    await repo.setBudgetLimit(regalos, 10000, '2026-09');
    await repo.updateCategory(regalos, { kind: 'income' });

    // Still shown, as it has a limit, and it can't be raised or set again…
    expect(await limitsIn(repo, '2026-10')).toEqual({ Regalos: 10000 });
    await expect(repo.setBudgetLimit(regalos, 20000, '2026-10')).rejects.toThrow();
    expect(await limitsIn(repo, '2026-10')).toEqual({ Regalos: 10000 });

    // …but "Quitar presupuesto" still works.
    await repo.setBudgetLimit(regalos, 0, '2026-10');
    expect(await limitsIn(repo, '2026-09')).toEqual({ Regalos: 10000 });
    expect(await limitsIn(repo, '2026-10')).toEqual({});
    // With no budget left from October there is nothing to remove there.
    await expect(repo.setBudgetLimit(regalos, 0, '2026-11')).rejects.toThrow();
    await expect(repo.setBudgetLimit(await categoryId(repo, 'Nómina'), 0)).rejects.toThrow();
  });

  it('lists the budgets of a month in category order', async () => {
    const repo = await setup();
    await repo.setBudgetLimit(await categoryId(repo, 'Ocio'), 5000);
    await repo.setBudgetLimit(await categoryId(repo, 'Supermercado'), 40000);
    await repo.setBudgetLimit(await categoryId(repo, 'Restaurantes'), 30000);

    expect(Object.keys(await limitsIn(repo, '2026-10'))).toEqual(['Supermercado', 'Restaurantes', 'Ocio']);
  });
});

describe('spending against a budget', () => {
  const october: SampleMovement[] = [
    // Booked in October but paid in September: it's September's spending.
    { valor: '30/09/2026', fecha: '02/10/2026', concepto: 'Glovo', movimiento: 'Pago con tarjeta', importe: -12 },
    { valor: '03/10/2026', concepto: 'Glovo', movimiento: 'Pago con tarjeta', importe: -40 },
    { valor: '05/10/2026', concepto: 'Bizum', movimiento: 'Recibido: cena', importe: 15 },
    { valor: '06/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -20 },
    { valor: '07/10/2026', concepto: 'Bar sin regla', movimiento: 'Pago con tarjeta', importe: -100 },
    { valor: '08/10/2026', concepto: 'Revolut**5625*', movimiento: 'Pago con tarjeta', importe: -200 },
  ];

  it("is the category's expenses minus its income in the month, by the transaction's date", async () => {
    const repo = await setup();
    await importFile(repo, october);
    const restaurantes = await categoryId(repo, 'Restaurantes');
    await repo.setBudgetLimit(restaurantes, 30000, '2026-09');
    // A received Bizum for a shared dinner, categorized as Restaurantes, reduces its spending.
    await repo.updateTransaction(await transactionId(repo, '2026-10', 'Recibido: cena'), { categoryId: restaurantes });

    expect(await budgetOf(repo, '2026-10', 'Restaurantes')).toMatchObject({ limit: 30000, spent: 2500 });
    expect(await budgetOf(repo, '2026-09', 'Restaurantes')).toMatchObject({ limit: 30000, spent: 1200 });
  });

  it('never counts transfers, balance adjustments or uncategorized transactions', async () => {
    const repo = await setup();
    await importFile(repo, october);
    const restaurantes = await categoryId(repo, 'Restaurantes');
    await repo.setBudgetLimit(restaurantes, 30000);
    await repo.setBudgetLimit(await categoryId(repo, 'Supermercado'), 30000);
    const { id: revolutId } = (await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string };
    const topUp = (await repo.listTransactions('2026-10')).find((tx) => tx.bankConcept === 'Revolut**5625*')!;
    await repo.updateTransaction(topUp.id, { transferAccountId: revolutId });
    // A balance adjustment, even if the user gives it a category, never counts.
    await repo.updateAccountBalance(revolutId, 15000);
    const adjustment = (await repo.listTransactions('2026-10')).find((tx) => tx.source === 'adjustment')!;
    await repo.updateTransaction(adjustment.id, { categoryId: restaurantes });

    const month = await repo.budgets('2026-10');
    expect(month.budgets.map((budget) => [budget.category.name, budget.spent])).toEqual([
      ['Supermercado', 2000],
      ['Restaurantes', 4000],
    ]);
    // The 100 € with no category and the 200 € transfer count nowhere.
    expect(month.totals).toEqual({ budgeted: 60000, spent: 6000, remaining: 54000 });
  });

  it('shows 0 % when more came back than was spent', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '03/10/2026', concepto: 'Glovo', movimiento: 'Pago con tarjeta', importe: -40 },
      { valor: '15/10/2026', concepto: 'Bizum', movimiento: 'Recibido: cumple', importe: 60 },
    ]);
    const restaurantes = await categoryId(repo, 'Restaurantes');
    await repo.setBudgetLimit(restaurantes, 30000);
    await repo.updateTransaction(await transactionId(repo, '2026-10', 'Recibido: cumple'), { categoryId: restaurantes });

    expect(await budgetOf(repo, '2026-10', 'Restaurantes')).toMatchObject({ spent: -2000, percent: 0, status: 'onTrack' });
  });
});

describe('the status of a budget', () => {
  it('is En camino below 85 %, Cerca from 85 % to 100 % and Superado above 100 %', async () => {
    const repo = await setup();
    const spending: [string, number][] = [
      ['Ocio', -84],
      ['Compras', -85],
      ['Viajes', -100],
      ['Regalos', -101],
    ];
    await importFile(
      repo,
      spending.map(([name, importe]) => ({ valor: '02/10/2026', concepto: 'Tienda', movimiento: name, importe })),
    );
    for (const [name] of spending) {
      const id = await categoryId(repo, name);
      await repo.setBudgetLimit(id, 10000);
      await repo.updateTransaction(await transactionId(repo, '2026-10', name), { categoryId: id });
    }

    const statuses = (await repo.budgets('2026-10')).budgets.map((budget) => [budget.category.name, budget.percent, budget.status]);
    expect(statuses).toEqual([
      ['Ocio', 84, 'onTrack'],
      ['Compras', 85, 'near'],
      ['Viajes', 100, 'near'],
      ['Regalos', 101, 'over'],
    ]);
  });

  it('goes by the exact amounts: a cent below 85 % is still En camino, a cent over the limit is Superado', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '02/10/2026', concepto: 'Tienda', movimiento: 'Ocio', importe: -84.99 },
      { valor: '02/10/2026', concepto: 'Tienda', movimiento: 'Viajes', importe: -100.01 },
    ]);
    for (const name of ['Ocio', 'Viajes']) {
      const id = await categoryId(repo, name);
      await repo.setBudgetLimit(id, 10000);
      await repo.updateTransaction(await transactionId(repo, '2026-10', name), { categoryId: id });
    }

    expect(await budgetOf(repo, '2026-10', 'Ocio')).toMatchObject({ spent: 8499, status: 'onTrack' });
    expect((await budgetOf(repo, '2026-10', 'Ocio'))!.percent).toBeCloseTo(84.99);
    expect(await budgetOf(repo, '2026-10', 'Viajes')).toMatchObject({ spent: 10001, status: 'over' });
  });
});

describe('the "today" marker and the totals', () => {
  it("sits at today's share of the current month, and nowhere in other months", async () => {
    const repo = await setup();
    expect((await repo.budgets('2026-10')).today).toBeCloseTo(20 / 31);
    expect((await repo.budgets('2026-09')).today).toBeNull();

    const february = await setup(() => new Date('2026-02-14T23:30:00'));
    expect((await february.budgets('2026-02')).today).toBeCloseTo(14 / 28);
  });

  it('adds up the budgeted categories only, with a negative remaining when overspent', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '02/10/2026', concepto: 'Glovo', movimiento: 'Pago con tarjeta', importe: -350 },
      { valor: '03/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -80 },
      { valor: '04/10/2026', concepto: 'Repsol', movimiento: 'Pago con tarjeta', importe: -60 },
    ]);
    await repo.setBudgetLimit(await categoryId(repo, 'Restaurantes'), 30000);
    await repo.setBudgetLimit(await categoryId(repo, 'Supermercado'), 20000);

    const month = await repo.budgets('2026-10');
    expect(month.totals).toEqual({ budgeted: 50000, spent: 43000, remaining: 7000 });
    expect(await budgetOf(repo, '2026-10', 'Restaurantes')).toMatchObject({ status: 'over' });

    await repo.setBudgetLimit(await categoryId(repo, 'Supermercado'), 5000);
    expect((await repo.budgets('2026-10')).totals).toEqual({ budgeted: 35000, spent: 43000, remaining: -8000 });
  });
});

describe('budgets over on Inicio', () => {
  it('counts none without budgets, or when every budget is at most at its limit', async () => {
    const repo = await setup();
    expect((await repo.home('2026-10')).budgetsOver).toBe(0);

    await spend(repo, [['Ocio', -50], ['Viajes', -100]]);
    await repo.setBudgetLimit(await categoryId(repo, 'Ocio'), 10000);
    await repo.setBudgetLimit(await categoryId(repo, 'Viajes'), 10000);

    // Viajes is exactly at its limit: Cerca, not Superado.
    expect((await repo.home('2026-10')).budgetsOver).toBe(0);
  });

  it('counts one budget over its limit, then several', async () => {
    const repo = await setup();
    await spend(repo, [['Ocio', -50], ['Viajes', -100.01], ['Regalos', -300]]);
    for (const name of ['Ocio', 'Viajes', 'Regalos']) await repo.setBudgetLimit(await categoryId(repo, name), 10000);
    expect((await repo.home('2026-10')).budgetsOver).toBe(2);

    await repo.setBudgetLimit(await categoryId(repo, 'Viajes'), 20000);
    expect((await repo.home('2026-10')).budgetsOver).toBe(1);

    await repo.setBudgetLimit(await categoryId(repo, 'Ocio'), 4000);
    await repo.setBudgetLimit(await categoryId(repo, 'Viajes'), 5000);
    expect((await repo.home('2026-10')).budgetsOver).toBe(3);
  });

  it('ignores budgets over in past months', async () => {
    const repo = await setup();
    await spend(repo, [['Ocio', -150]], '10/09/2026');
    await repo.setBudgetLimit(await categoryId(repo, 'Ocio'), 10000, '2026-09');
    expect((await budgetOf(repo, '2026-09', 'Ocio'))!.status).toBe('over');

    expect((await repo.home('2026-10')).budgetsOver).toBe(0);
    expect((await repo.home('2026-09')).budgetsOver).toBe(0);
  });

  it("goes by the clock's current month whatever month Inicio shows", async () => {
    const repo = await setup();
    await spend(repo, [['Ocio', -150]]);
    await repo.setBudgetLimit(await categoryId(repo, 'Ocio'), 10000, '2026-09');

    expect((await repo.home('2026-10')).budgetsOver).toBe(1);
    expect((await repo.home('2026-09')).budgetsOver).toBe(1);
    expect((await repo.home('2026-08')).budgetsOver).toBe(1);

    // In November, October's overspending is a past month's.
    const november = await setup(() => new Date('2026-11-02T10:00:00'));
    await spend(november, [['Ocio', -150]]);
    await november.setBudgetLimit(await categoryId(november, 'Ocio'), 10000, '2026-10');
    expect((await november.home('2026-10')).budgetsOver).toBe(0);
    expect((await november.home('2026-11')).budgetsOver).toBe(0);
  });
});

describe('the top budgets on Inicio', () => {
  const topOn = async (repo: DataRepository, month: string) =>
    (await repo.home(month)).topBudgets.map((budget) => [budget.category.name, budget.spent, budget.limit, budget.status]);

  it('shows none without budgets this month', async () => {
    const repo = await setup();
    expect((await repo.home('2026-10')).topBudgets).toEqual([]);
  });

  it('shows the 3 with the highest percentage, ties broken by the most spent', async () => {
    const repo = await setup();
    await spend(repo, [['Ocio', -50], ['Viajes', -100], ['Regalos', -120], ['Compras', -90], ['Restaurantes', -10]]);
    await repo.setBudgetLimit(await categoryId(repo, 'Ocio'), 10000);
    await repo.setBudgetLimit(await categoryId(repo, 'Viajes'), 20000);
    await repo.setBudgetLimit(await categoryId(repo, 'Regalos'), 10000);
    await repo.setBudgetLimit(await categoryId(repo, 'Compras'), 10000);
    await repo.setBudgetLimit(await categoryId(repo, 'Restaurantes'), 10000);

    // Ocio and Viajes are both at 50 %: Viajes spent more. Restaurantes, at 10 %, is left out.
    expect(await topOn(repo, '2026-10')).toEqual([
      ['Regalos', 12000, 10000, 'over'],
      ['Compras', 9000, 10000, 'near'],
      ['Viajes', 10000, 20000, 'onTrack'],
    ]);
  });

  it('shows fewer when there are fewer budgets', async () => {
    const repo = await setup();
    await spend(repo, [['Ocio', -30]]);
    await repo.setBudgetLimit(await categoryId(repo, 'Ocio'), 10000);
    await repo.setBudgetLimit(await categoryId(repo, 'Viajes'), 10000);

    expect(await topOn(repo, '2026-10')).toEqual([
      ['Ocio', 3000, 10000, 'onTrack'],
      ['Viajes', 0, 10000, 'onTrack'],
    ]);
  });

  it("goes by the clock's current month whatever month Inicio shows", async () => {
    const repo = await setup();
    await spend(repo, [['Ocio', -150]], '10/09/2026');
    await spend(repo, [['Viajes', -20]]);
    await repo.setBudgetLimit(await categoryId(repo, 'Ocio'), 10000, '2026-09');
    await repo.setBudgetLimit(await categoryId(repo, 'Viajes'), 10000, '2026-10');

    // Ocio's spending was in September, and Viajes had no budget then: October is shown all the same.
    const october = [
      ['Viajes', 2000, 10000, 'onTrack'],
      ['Ocio', 0, 10000, 'onTrack'],
    ];
    expect(await topOn(repo, '2026-10')).toEqual(october);
    expect(await topOn(repo, '2026-09')).toEqual(october);
    expect(await topOn(repo, '2026-08')).toEqual(october);

    // In November there's nothing spent yet.
    const november = await setup(() => new Date('2026-11-02T10:00:00'));
    await spend(november, [['Ocio', -150]]);
    await november.setBudgetLimit(await categoryId(november, 'Ocio'), 10000, '2026-10');
    expect(await topOn(november, '2026-10')).toEqual([['Ocio', 0, 10000, 'onTrack']]);
  });
});
