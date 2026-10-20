import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

async function setup() {
  const repo = createDexieRepository({ name: `kuenta-apply-${++dbCount}`, now: () => new Date('2026-10-20T10:00:00') });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return repo;
}

async function importFile(repo: DataRepository, movements: SampleMovement[]) {
  const result = await repo.previewImport(await bbvaXlsx(movements), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return repo.commitImport(result.preview);
}

async function categoryId(repo: DataRepository, name: string) {
  const category = (await repo.listCategories()).find((c) => c.name === name);
  if (!category) throw new Error(`No category ${name}`);
  return category.id;
}

async function transaction(repo: DataRepository, concept: string, month = '2026-09') {
  const tx = (await repo.listTransactions(month)).find((t) => t.bankConcept === concept);
  if (!tx) throw new Error(`No transaction with concept ${concept}`);
  return tx;
}

describe('applying a rule to transactions already imported', () => {
  it('sets the rule\'s category on the matching transactions and says how many changed', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Panaderia Pepe', importe: -2 },
      { valor: '02/09/2026', concepto: 'Panaderia Pepe', importe: -3 },
      { valor: '03/09/2026', concepto: 'Kfc', importe: -9 },
    ]);
    const rule = await repo.createRule({ name: 'Pepe', match: { value: 'panaderia' }, actions: { categoryId: await categoryId(repo, 'Supermercado') } });

    expect(await repo.applyRules(rule)).toBe(2);
    const txs = await repo.listTransactions('2026-09');
    expect(txs.filter((tx) => tx.bankConcept === 'Panaderia Pepe').map((tx) => tx.category?.name)).toEqual(['Supermercado', 'Supermercado']);
    expect((await transaction(repo, 'Kfc')).category).toBeNull();
  });

  it('never changes a transaction the user edited, whether its category, payee or note', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Panaderia Pepe 1', importe: -2 },
      { valor: '02/09/2026', concepto: 'Panaderia Pepe 2', importe: -3 },
      { valor: '03/09/2026', concepto: 'Panaderia Pepe 3', importe: -4 },
      { valor: '04/09/2026', concepto: 'Panaderia Pepe 4', importe: -5 },
    ]);
    const leisure = await categoryId(repo, 'Ocio');
    await repo.updateTransaction((await transaction(repo, 'Panaderia Pepe 1')).id, { categoryId: leisure });
    await repo.updateTransaction((await transaction(repo, 'Panaderia Pepe 2')).id, { payeeName: 'Pepe' });
    await repo.updateTransaction((await transaction(repo, 'Panaderia Pepe 3')).id, { note: 'pan' });
    const rule = await repo.createRule({ name: 'Pepe', match: { value: 'panaderia' }, actions: { categoryId: await categoryId(repo, 'Supermercado') } });

    expect(await repo.applyRules(rule)).toBe(1);
    expect((await transaction(repo, 'Panaderia Pepe 1')).category?.name).toBe('Ocio');
    expect((await transaction(repo, 'Panaderia Pepe 2')).category).toBeNull();
    expect((await transaction(repo, 'Panaderia Pepe 3')).category).toBeNull();
    expect((await transaction(repo, 'Panaderia Pepe 4')).category?.name).toBe('Supermercado');
  });

  it('leaves the transactions never edited, so a later rule can still change them', async () => {
    const repo = await setup();
    const { batch } = await importFile(repo, [{ valor: '01/09/2026', concepto: 'Panaderia Pepe', importe: -2 }]);
    const first = await repo.createRule({ name: 'Pan', match: { value: 'panaderia' }, actions: { categoryId: await categoryId(repo, 'Supermercado') } });
    await repo.applyRules(first);
    expect((await transaction(repo, 'Panaderia Pepe')).editedAt).toBeNull();
    expect(await repo.editedCountInImport(batch.id)).toBe(0);

    const second = await repo.createRule({ name: 'Pepe', match: { value: 'pepe' }, actions: { categoryId: await categoryId(repo, 'Restaurantes') } });
    expect(await repo.applyRules(second)).toBe(1);
    expect((await transaction(repo, 'Panaderia Pepe')).category?.name).toBe('Restaurantes');
  });

  it('sets the rule\'s payee, reusing an existing payee with the same normalized name', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Pan pepe 1', importe: -2 },
      { valor: '02/09/2026', concepto: 'Panadería Pepe', importe: -3 },
    ]);
    const rule = await repo.createRule({ name: 'Pepe', match: { value: 'pan pepe' }, actions: { payeeName: 'panaderia pepe' } });

    expect(await repo.applyRules(rule)).toBe(1);
    const txs = await repo.listTransactions('2026-09');
    expect(new Set(txs.map((tx) => tx.payeeId)).size).toBe(1);
    expect(txs.map((tx) => tx.payee?.name)).toEqual(['Panadería Pepe', 'Panadería Pepe']);
  });

  it('counts nothing for transactions the rule leaves as they were', async () => {
    const repo = await setup();
    await importFile(repo, [{ valor: '01/09/2026', concepto: 'Mercadona', importe: -20 }]);
    const mercadona = (await repo.listRules()).find((rule) => rule.name === 'Mercadona')!;
    expect(await repo.applyRules(mercadona.id)).toBe(0);
  });
});

describe('applying every rule to transactions already imported', () => {
  it('lets the first enabled matching rule win, skips disabled ones, and says how many changed', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Panaderia Pepe', importe: -2 },
      { valor: '02/09/2026', concepto: 'Panaderia Ana', importe: -3 },
      { valor: '03/09/2026', concepto: 'Kfc', importe: -9 },
    ]);
    await repo.createRule({ name: 'Pan', match: { value: 'panaderia' }, actions: { categoryId: await categoryId(repo, 'Supermercado') } });
    await repo.createRule({ name: 'Pepe', match: { value: 'pepe' }, actions: { categoryId: await categoryId(repo, 'Restaurantes') } });
    const kfc = await repo.createRule({ name: 'Kfc', match: { value: 'kfc' }, actions: { categoryId: await categoryId(repo, 'Restaurantes') } });
    await repo.updateRule(kfc, { enabled: false });

    expect(await repo.applyRules()).toBe(2);
    expect((await transaction(repo, 'Panaderia Pepe')).category?.name).toBe('Restaurantes');
    expect((await transaction(repo, 'Panaderia Ana')).category?.name).toBe('Supermercado');
    expect((await transaction(repo, 'Kfc')).category).toBeNull();
  });

  it('brings down the uncategorized count on Inicio', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '01/10/2026', concepto: 'Panaderia Pepe', importe: -2 },
      { valor: '02/10/2026', concepto: 'Kfc', importe: -9 },
    ]);
    expect((await repo.home('2026-10')).uncategorized).toBe(2);
    await repo.createRule({ name: 'Pan', match: { value: 'panaderia' }, actions: { categoryId: await categoryId(repo, 'Supermercado') } });
    await repo.applyRules();
    expect((await repo.home('2026-10')).uncategorized).toBe(1);
  });
});

describe('previewing a draft rule', () => {
  it('counts every matching transaction, and the never-edited ones it would change', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Panaderia Pepe', importe: -2 },
      { valor: '02/09/2026', concepto: 'Panaderia Pepe', importe: -3 },
      { valor: '03/09/2026', concepto: 'PANADERÍA pepe', importe: -4 },
      { valor: '04/09/2026', concepto: 'Kfc', importe: -9 },
    ]);
    const supermercado = await categoryId(repo, 'Supermercado');
    await repo.updateTransaction((await repo.listTransactions('2026-09')).find((t) => t.amount === 300)!.id, { note: 'pan' });

    const preview = await repo.previewRule({ match: { value: 'panaderia' }, actions: { categoryId: supermercado } });
    expect(preview).toEqual({ matching: 3, applicable: 2 });
    // Nothing is written.
    expect((await repo.listTransactions('2026-09')).every((t) => t.categoryId === null)).toBe(true);
  });

  it('respects the advanced options and finds nothing for an empty text', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Bizum', movimiento: 'Recibido: alquiler', importe: 400 },
      { valor: '02/09/2026', concepto: 'Bizum', movimiento: 'ENVIADO: alquiler', importe: -400 },
    ]);
    const otros = await categoryId(repo, 'Otros ingresos');
    expect(await repo.previewRule({ match: { value: 'alquiler' }, actions: { categoryId: otros } })).toEqual({ matching: 2, applicable: 2 });
    expect(await repo.previewRule({ match: { value: 'alquiler', direction: 'in' }, actions: { categoryId: otros } })).toEqual({
      matching: 1,
      applicable: 1,
    });
    expect(await repo.previewRule({ match: { value: 'alquiler', field: 'concept' }, actions: { categoryId: otros } })).toEqual({
      matching: 0,
      applicable: 0,
    });
    expect(await repo.previewRule({ match: { value: '  ' }, actions: { categoryId: otros } })).toEqual({ matching: 0, applicable: 0 });
  });
});
