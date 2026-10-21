import { describe, expect, it } from 'vitest';
import { KuentaDb } from '../src/data/dexie/db';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

async function setup(now = () => new Date('2026-10-20T10:00:00'), name = `kuenta-categories-test-${++dbCount}`) {
  const repo = createDexieRepository({ name, now });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return repo;
}

async function importFile(repo: DataRepository, movements: SampleMovement[]) {
  const result = await repo.previewImport(await bbvaXlsx(movements), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return repo.commitImport(result.preview);
}

async function categoryNamed(repo: DataRepository, name: string) {
  const category = (await repo.listCategories()).find((c) => c.name === name);
  if (!category) throw new Error(`No category named ${name}`);
  return category;
}

const namesOfKind = async (repo: DataRepository, kind: 'expense' | 'income') =>
  (await repo.listCategories()).filter((c) => c.kind === kind).map((c) => c.name);

describe('creating a category', () => {
  it('adds it after the existing categories of its kind, with its icon and colour', async () => {
    const repo = await setup();

    const result = await repo.createCategory({ name: '  Mascotas ', kind: 'expense', icon: 'heart-pulse', color: 'teal' });

    expect(result.ok).toBe(true);
    const created = await categoryNamed(repo, 'Mascotas');
    expect(created).toMatchObject({ kind: 'expense', icon: 'heart-pulse', color: 'teal' });
    expect(result).toEqual({ ok: true, id: created.id });
    expect((await namesOfKind(repo, 'expense')).at(-1)).toBe('Mascotas');
    expect((await namesOfKind(repo, 'income')).at(-1)).toBe('Otros ingresos');
  });

  it('refuses an empty name, or one another category has ignoring case and accents', async () => {
    const repo = await setup();
    const before = await repo.listCategories();
    const salud = await categoryNamed(repo, 'Salud');
    const nomina = await categoryNamed(repo, 'Nómina');

    expect(await repo.createCategory({ name: '   ', kind: 'expense', icon: 'gift', color: 'red' })).toEqual({ ok: false, reason: 'empty' });
    expect(await repo.createCategory({ name: ' SALUD ', kind: 'expense', icon: 'gift', color: 'red' })).toEqual({
      ok: false,
      reason: 'exists',
      existing: salud,
    });
    // Also across kinds: a picker never shows two categories with the same name.
    expect(await repo.createCategory({ name: 'nomina', kind: 'expense', icon: 'gift', color: 'red' })).toMatchObject({
      ok: false,
      reason: 'exists',
      existing: { id: nomina.id },
    });
    expect(await repo.listCategories()).toEqual(before);
  });
});

describe('editing a category', () => {
  it('renames it and changes its icon, colour and kind, shown on its transactions', async () => {
    const repo = await setup();
    await importFile(repo, [{ valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -42.1 }]);
    const supermercado = await categoryNamed(repo, 'Supermercado');

    expect(await repo.updateCategory(supermercado.id, { name: ' Súper  y casa ', icon: 'home', color: 'lime' })).toEqual({
      ok: true,
      id: supermercado.id,
    });

    const [tx] = await repo.listTransactions('2026-10');
    expect(tx.category).toMatchObject({ id: supermercado.id, name: 'Súper y casa', icon: 'home', color: 'lime', kind: 'expense' });
    await repo.updateCategory(supermercado.id, { kind: 'income' });
    expect(await namesOfKind(repo, 'income')).toContain('Súper y casa');
  });

  it('allows changing only the case or accents of its own name', async () => {
    const repo = await setup();
    const salud = await categoryNamed(repo, 'Salud');
    expect(await repo.updateCategory(salud.id, { name: 'SALUD' })).toEqual({ ok: true, id: salud.id });
    expect((await repo.listCategories()).map((c) => c.name)).toContain('SALUD');
  });

  it('refuses an empty name, or one another category has', async () => {
    const repo = await setup();
    const before = await repo.listCategories();
    const salud = await categoryNamed(repo, 'Salud');
    const ocio = await categoryNamed(repo, 'Ocio');

    expect(await repo.updateCategory(salud.id, { name: ' ', color: 'blue' })).toEqual({ ok: false, reason: 'empty' });
    expect(await repo.updateCategory(salud.id, { name: 'ÓCIO', color: 'blue' })).toEqual({ ok: false, reason: 'exists', existing: ocio });
    expect(await repo.listCategories()).toEqual(before);
  });
});

describe('reordering categories', () => {
  it('moves a category up or down among those of its kind', async () => {
    const repo = await setup();

    await repo.moveCategory((await categoryNamed(repo, 'Ocio')).id, 'up');
    await repo.moveCategory((await categoryNamed(repo, 'Supermercado')).id, 'down');
    await repo.moveCategory((await categoryNamed(repo, 'Otros ingresos')).id, 'up');

    expect((await namesOfKind(repo, 'expense')).slice(0, 7)).toEqual([
      'Restaurantes',
      'Supermercado',
      'Transporte',
      'Vivienda',
      'Suministros',
      'Ocio',
      'Salud',
    ]);
    expect(await namesOfKind(repo, 'income')).toEqual(['Nómina', 'Reembolsos', 'Intereses', 'Otros ingresos', 'Prestaciones']);
  });

  it('leaves the first and last of a kind where they are', async () => {
    const repo = await setup();
    const before = await repo.listCategories();

    await repo.moveCategory((await categoryNamed(repo, 'Supermercado')).id, 'up');
    await repo.moveCategory((await categoryNamed(repo, 'Otros gastos')).id, 'down');
    await repo.moveCategory((await categoryNamed(repo, 'Nómina')).id, 'up');
    await repo.moveCategory((await categoryNamed(repo, 'Otros ingresos')).id, 'down');

    expect(await repo.listCategories()).toEqual(before);
  });

  it('places a category whose kind changed among those of its new kind, in its order', async () => {
    const repo = await setup();
    const created = await repo.createCategory({ name: 'Ventas', kind: 'expense', icon: 'receipt', color: 'cyan' });
    if (!created.ok) throw new Error('Expected the category to be created');
    await repo.updateCategory(created.id, { kind: 'income' });

    await repo.moveCategory(created.id, 'up');

    expect((await namesOfKind(repo, 'income')).slice(-2)).toEqual(['Ventas', 'Otros ingresos']);
  });
});

const september: SampleMovement[] = [
  { valor: '01/09/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -42.1 },
  { valor: '02/09/2026', concepto: 'Lidl', movimiento: 'Pago con tarjeta', importe: -20 },
  { valor: '03/09/2026', concepto: 'Fruteria pepa', movimiento: 'Pago con tarjeta', importe: -8.4 },
  { valor: '04/09/2026', concepto: 'Repsol', movimiento: 'Pago con tarjeta', importe: -50 },
  { valor: '05/09/2026', concepto: 'Bizum', movimiento: 'Recibido: compra', importe: 10 },
];

describe('what deleting a category affects', () => {
  it('counts its transactions and the rules that set it', async () => {
    const repo = await setup();
    await importFile(repo, september);
    const supermercado = await categoryNamed(repo, 'Supermercado');
    const [fruteria] = (await repo.listTransactions('2026-09')).filter((tx) => tx.bankConcept === 'Fruteria pepa');
    await repo.updateTransaction(fruteria.id, { categoryId: supermercado.id });

    // Mercadona, Carrefour, Alcampo, Lidl and Dia are starter rules for Supermercado.
    expect(await repo.categoryUsage(supermercado.id)).toEqual({ transactions: 3, rules: 5, budget: false });
    expect(await repo.categoryUsage((await categoryNamed(repo, 'Viajes')).id)).toEqual({ transactions: 0, rules: 0, budget: false });
  });

  it('says whether it has a budget, in this month or an earlier one', async () => {
    const repo = await setup();
    const viajes = await categoryNamed(repo, 'Viajes');
    const ocio = await categoryNamed(repo, 'Ocio');
    await repo.setBudgetLimit(viajes.id, 30000);
    // Ocio had a budget in September only.
    await repo.setBudgetLimit(ocio.id, 5000, '2026-09');
    await repo.setBudgetLimit(ocio.id, 0, '2026-10');

    expect(await repo.categoryUsage(viajes.id)).toEqual({ transactions: 0, rules: 0, budget: true });
    expect((await repo.categoryUsage(ocio.id)).budget).toBe(true);
    expect((await repo.categoryUsage((await categoryNamed(repo, 'Compras')).id)).budget).toBe(false);
  });
});

describe('deleting a category', () => {
  it('removes an unused category', async () => {
    const repo = await setup();
    await importFile(repo, september);
    const viajes = await categoryNamed(repo, 'Viajes');
    const before = await repo.listTransactions('2026-09');

    await repo.deleteCategory(viajes.id, null);

    expect((await repo.listCategories()).map((c) => c.name)).not.toContain('Viajes');
    expect(await repo.listTransactions('2026-09')).toEqual(before);
  });

  it('moves its transactions to the chosen category', async () => {
    const repo = await setup();
    await importFile(repo, september);
    const supermercado = await categoryNamed(repo, 'Supermercado');
    const compras = await categoryNamed(repo, 'Compras');

    await repo.deleteCategory(supermercado.id, compras.id);

    const categoryOf = Object.fromEntries((await repo.listTransactions('2026-09')).map((tx) => [tx.bankConcept, tx.category?.name ?? null]));
    expect(categoryOf).toEqual({ Mercadona: 'Compras', Lidl: 'Compras', 'Fruteria pepa': null, Repsol: 'Transporte', Bizum: null });
    expect((await repo.listCategories()).map((c) => c.name)).not.toContain('Supermercado');
  });

  it('leaves its transactions without a category when the user chooses "Sin categoría"', async () => {
    const repo = await setup();
    await importFile(repo, september);
    const supermercado = await categoryNamed(repo, 'Supermercado');

    await repo.deleteCategory(supermercado.id, null);

    const txs = await repo.listTransactions('2026-09');
    expect(txs.filter((tx) => tx.category === null).map((tx) => tx.bankConcept).sort()).toEqual(['Bizum', 'Fruteria pepa', 'Lidl', 'Mercadona']);
    expect((await repo.home('2026-09')).uncategorized).toBe(4);
  });

  it('keeps the edited marker of the moved transactions, and every balance', async () => {
    let clock = new Date('2026-10-20T10:00:00');
    const repo = await setup(() => clock);
    await importFile(repo, september);
    const supermercado = await categoryNamed(repo, 'Supermercado');
    const salud = await categoryNamed(repo, 'Salud');
    const byConcept = async (concept: string) => (await repo.listTransactions('2026-09')).find((tx) => tx.bankConcept === concept)!;
    // Fruteria pepa is categorized by hand; Mercadona by a starter rule, so never edited.
    await repo.updateTransaction((await byConcept('Fruteria pepa')).id, { categoryId: supermercado.id });
    const edited = await byConcept('Fruteria pepa');
    const accountsBefore = await repo.listAccounts();
    const summaryBefore = (await repo.home('2026-09')).summary;

    clock = new Date('2026-10-21T18:30:00');
    await repo.deleteCategory(supermercado.id, salud.id);

    expect(await byConcept('Fruteria pepa')).toMatchObject({ categoryId: salud.id, editedAt: edited.editedAt, amount: 840, date: '2026-09-03' });
    expect(await byConcept('Mercadona')).toMatchObject({ categoryId: salud.id, editedAt: null, amount: 4210, date: '2026-09-01' });
    expect((await repo.listAccounts()).map((a) => a.balance)).toEqual(accountsBefore.map((a) => a.balance));
    expect((await repo.home('2026-09')).summary).toEqual(summaryBefore);
    expect((await repo.balanceCheck())!.difference).toBe(0);
  });

  it('disables the rules that set it, keeping them to be repointed', async () => {
    const repo = await setup();
    await importFile(repo, september);
    const supermercado = await categoryNamed(repo, 'Supermercado');
    const compras = await categoryNamed(repo, 'Compras');
    const rulesBefore = await repo.listRules();

    await repo.deleteCategory(supermercado.id, compras.id);

    const rules = await repo.listRules();
    expect(rules.map((rule) => rule.id)).toEqual(rulesBefore.map((rule) => rule.id));
    const changedRules = rules.filter((rule) => !rule.enabled);
    expect(changedRules.map((rule) => rule.name)).toEqual(['Mercadona', 'Carrefour', 'Alcampo', 'Lidl', 'Dia']);
    expect(changedRules.map((rule) => rule.actions.categoryId)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(rules.find((rule) => rule.name === 'Mercadona')!.match).toEqual(rulesBefore.find((rule) => rule.name === 'Mercadona')!.match);
    expect(rules.filter((rule) => rule.enabled)).toEqual(rulesBefore.filter((rule) => rule.actions.categoryId !== supermercado.id));

    // The next import no longer files Mercadona anywhere.
    await importFile(repo, [...september, { valor: '08/09/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -5 }]);
    const latest = (await repo.listTransactions('2026-09')).find((tx) => tx.date === '2026-09-08')!;
    expect(latest.categoryId).toBeNull();
  });

  it('deletes every budget limit it had, leaving the other categories’ budgets', async () => {
    const name = 'kuenta-categories-test-budgets';
    const repo = await setup(undefined, name);
    await importFile(repo, september);
    const supermercado = await categoryNamed(repo, 'Supermercado');
    const restaurantes = await categoryNamed(repo, 'Restaurantes');
    await repo.setBudgetLimit(supermercado.id, 30000, '2026-08');
    await repo.setBudgetLimit(supermercado.id, 25000, '2026-10');
    await repo.setBudgetLimit(supermercado.id, 0, '2026-11');
    await repo.setBudgetLimit(restaurantes.id, 20000, '2026-09');

    await repo.deleteCategory(supermercado.id, null);

    const db = new KuentaDb(name);
    const limits = await db.budgetLimits.toArray();
    db.close();
    expect(limits.map((limit) => [limit.categoryId, limit.fromMonth, limit.amount])).toEqual([[restaurantes.id, '2026-09', 20000]]);
    expect((await repo.budgets('2026-09')).budgets.map((budget) => budget.category.name)).toEqual(['Restaurantes']);
  });

  it('keeps the payee a disabled rule sets', async () => {
    const repo = await setup();
    const compras = await categoryNamed(repo, 'Compras');

    await repo.deleteCategory(compras.id, null);

    expect((await repo.listRules()).find((rule) => rule.name === 'Amazon')).toMatchObject({ enabled: false, actions: { payeeName: 'Amazon' } });
  });

  it('changes nothing when the transactions can’t be moved where the user chose', async () => {
    const repo = await setup();
    await importFile(repo, september);
    const supermercado = await categoryNamed(repo, 'Supermercado');
    const compras = await categoryNamed(repo, 'Compras');
    await repo.deleteCategory(compras.id, null);
    await repo.setBudgetLimit(supermercado.id, 30000, '2026-09');
    const snapshot = async () => ({
      categories: await repo.listCategories(),
      rules: await repo.listRules(),
      transactions: await repo.listTransactions('2026-09'),
      budgets: await repo.budgets('2026-09'),
    });
    const before = await snapshot();

    // Compras was deleted meanwhile (e.g. in another tab), or the target is the category itself.
    await expect(repo.deleteCategory(supermercado.id, compras.id)).rejects.toThrow();
    await expect(repo.deleteCategory(supermercado.id, supermercado.id)).rejects.toThrow();

    expect(await snapshot()).toEqual(before);
  });
});
