import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository, ImportPreview } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

async function setup() {
  const repo = createDexieRepository({ name: `kuenta-import-preview-${++dbCount}`, now: () => new Date('2026-10-20T10:00:00') });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return repo;
}

async function preview(repo: DataRepository, movements: SampleMovement[]): Promise<ImportPreview> {
  const result = await repo.previewImport(await bbvaXlsx(movements), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return result.preview;
}

async function categoryId(repo: DataRepository, name: string) {
  const category = (await repo.listCategories()).find((c) => c.name === name);
  if (!category) throw new Error(`No category ${name}`);
  return category.id;
}

/** The fingerprint of the preview's row with this concept. */
function hashOf(preview: ImportPreview, concept: string) {
  const row = preview.plan.rows.find((r) => r.concept === concept);
  if (!row) throw new Error(`No row with concept ${concept}`);
  return row.hash;
}

/** The category each new row of the preview would get, by concept. */
function plannedCategories(preview: ImportPreview) {
  return new Map(preview.plan.rows.filter((row) => row.status === 'new').map((row) => [row.concept, row.categoryId]));
}

async function transaction(repo: DataRepository, concept: string) {
  const tx = (await repo.listTransactions('2026-09')).find((t) => t.bankConcept === concept);
  if (!tx) throw new Error(`No transaction with concept ${concept}`);
  return tx;
}

describe('categories chosen in the import preview', () => {
  it('are saved with the imported transactions, "Sin categoría" included', async () => {
    const repo = await setup();
    const file = await preview(repo, [
      { valor: '01/09/2026', concepto: 'Kfc', importe: -9 },
      { valor: '02/09/2026', concepto: 'Mercadona', importe: -20 },
      { valor: '03/09/2026', concepto: 'Repsol', importe: -50 },
    ]);
    await repo.commitImport(file, {
      categories: { [hashOf(file, 'Kfc')]: await categoryId(repo, 'Restaurantes'), [hashOf(file, 'Mercadona')]: null },
    });
    expect((await transaction(repo, 'Kfc')).category?.name).toBe('Restaurantes');
    expect((await transaction(repo, 'Mercadona')).category).toBeNull();
    expect((await transaction(repo, 'Repsol')).category?.name).toBe('Transporte');
  });

  it('count as edited by the user, so rules applied later leave them alone', async () => {
    const repo = await setup();
    const file = await preview(repo, [
      { valor: '01/09/2026', concepto: 'Kfc gran via', importe: -9 },
      { valor: '02/09/2026', concepto: 'Kfc sol', importe: -12 },
      { valor: '03/09/2026', concepto: 'Mercadona', importe: -20 },
    ]);
    const { batch } = await repo.commitImport(file, { categories: { [hashOf(file, 'Kfc sol')]: await categoryId(repo, 'Ocio') } });

    expect((await transaction(repo, 'Kfc sol')).editedAt).not.toBeNull();
    // Rows the user didn't touch stay never edited, even when a rule categorized them.
    expect((await transaction(repo, 'Kfc gran via')).editedAt).toBeNull();
    expect((await transaction(repo, 'Mercadona')).editedAt).toBeNull();
    expect(await repo.editedCountInImport(batch.id)).toBe(1);

    const ruleId = await repo.createRule({ name: 'Kfc', match: { value: 'kfc' }, actions: { categoryId: await categoryId(repo, 'Restaurantes') } });
    expect(await repo.applyRules(ruleId)).toBe(1);
    expect((await transaction(repo, 'Kfc gran via')).category?.name).toBe('Restaurantes');
    expect((await transaction(repo, 'Kfc sol')).category?.name).toBe('Ocio');
  });

  it("don't import excluded rows", async () => {
    const repo = await setup();
    const file = await preview(repo, [
      { valor: '01/09/2026', concepto: 'Kfc', importe: -9 },
      { valor: '02/09/2026', concepto: 'Mercadona', importe: -20 },
    ]);
    const kfc = hashOf(file, 'Kfc');
    const { batch } = await repo.commitImport(file, { exclude: [kfc], categories: { [kfc]: await categoryId(repo, 'Ocio') } });
    expect(batch.created).toBe(1);
    expect((await repo.listTransactions('2026-09')).map((tx) => tx.bankConcept)).toEqual(['Mercadona']);
  });
});

describe('re-planning the import preview', () => {
  it('runs the current rules again on its new rows, e.g. after creating a rule from one of them', async () => {
    const repo = await setup();
    const file = await preview(repo, [
      { valor: '01/09/2026', concepto: 'Kfc gran via', importe: -9 },
      { valor: '02/09/2026', concepto: 'Kfc sol', importe: -12 },
      { valor: '03/09/2026', concepto: 'Mercadona', importe: -20 },
    ]);
    expect(plannedCategories(file).get('Kfc sol')).toBeNull();

    const restaurants = await categoryId(repo, 'Restaurantes');
    await repo.createRule({ name: 'Kfc', match: { value: 'kfc' }, actions: { categoryId: restaurants, payeeName: 'KFC' } });
    const replanned = await repo.replanImport(file);

    const categories = plannedCategories(replanned);
    expect(categories.get('Kfc gran via')).toBe(restaurants);
    expect(categories.get('Kfc sol')).toBe(restaurants);
    expect(categories.get('Mercadona')).toBe(await categoryId(repo, 'Supermercado'));
    expect(replanned.plan.rows.find((row) => row.concept === 'Kfc sol')!.payeeName).toBe('KFC');
    expect(replanned.plan.warnings).toEqual(file.plan.warnings);
  });

  it('keeps the categories the user chose in the preview when importing', async () => {
    const repo = await setup();
    const file = await preview(repo, [
      { valor: '01/09/2026', concepto: 'Kfc gran via', importe: -9 },
      { valor: '02/09/2026', concepto: 'Kfc sol', importe: -12 },
    ]);
    const chosen = { [hashOf(file, 'Kfc sol')]: await categoryId(repo, 'Ocio') };
    await repo.createRule({ name: 'Kfc', match: { value: 'kfc' }, actions: { categoryId: await categoryId(repo, 'Restaurantes') } });
    await repo.commitImport(await repo.replanImport(file), { categories: chosen });

    expect((await transaction(repo, 'Kfc gran via')).category?.name).toBe('Restaurantes');
    expect((await transaction(repo, 'Kfc gran via')).editedAt).toBeNull();
    expect((await transaction(repo, 'Kfc sol')).category?.name).toBe('Ocio');
  });

  it('leaves rows imported before as they were', async () => {
    const repo = await setup();
    const movements: SampleMovement[] = [
      { valor: '01/09/2026', concepto: 'Kfc gran via', importe: -9 },
      { valor: '02/09/2026', concepto: 'Kfc sol', importe: -12 },
    ];
    await repo.commitImport(await preview(repo, movements.slice(0, 1)));
    const file = await preview(repo, movements);
    await repo.createRule({ name: 'Kfc', match: { value: 'kfc' }, actions: { categoryId: await categoryId(repo, 'Restaurantes') } });
    const replanned = await repo.replanImport(file);
    expect(replanned.plan.rows.map((row) => [row.concept, row.status])).toEqual(file.plan.rows.map((row) => [row.concept, row.status]));
    expect(replanned.plan.rows.find((row) => row.status === 'already-imported')).toEqual(
      file.plan.rows.find((row) => row.status === 'already-imported'),
    );
  });
});
