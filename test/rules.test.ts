import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository, ImportPreview } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

async function setup() {
  const repo = createDexieRepository({ name: `kuenta-rules-${++dbCount}`, now: () => new Date('2026-10-20T10:00:00') });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return repo;
}

async function preview(repo: DataRepository, movements: SampleMovement[]): Promise<ImportPreview> {
  const result = await repo.previewImport(await bbvaXlsx(movements), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return result.preview;
}

async function importFile(repo: DataRepository, movements: SampleMovement[]) {
  return repo.commitImport(await preview(repo, movements));
}

describe('starter data', () => {
  it('creates Prestaciones and Préstamos among the starter categories on first run', async () => {
    const repo = await setup();
    const categories = await repo.listCategories();
    expect(categories.find((c) => c.name === 'Prestaciones')).toMatchObject({ kind: 'income' });
    expect(categories.find((c) => c.name === 'Préstamos')).toMatchObject({ kind: 'expense' });
  });
});

async function categoryOf(repo: DataRepository, concept: string, month = '2026-09') {
  const tx = (await repo.listTransactions(month)).find((t) => t.bankConcept === concept);
  if (!tx) throw new Error(`No transaction with concept ${concept}`);
  return tx.category?.name ?? null;
}

describe('starter rules on import', () => {
  it('categorizes a Mercadona purchase as Supermercado', async () => {
    const repo = await setup();
    await importFile(repo, [{ valor: '01/09/2026', concepto: 'Mercadona - crta del inge', movimiento: 'Pago con tarjeta', importe: -42.1 }]);
    expect(await categoryOf(repo, 'Mercadona - crta del inge')).toBe('Supermercado');
  });

  it('categorizes the usual merchants and bank movements of a statement', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo sl', importe: 1500 },
      { valor: '02/09/2026', concepto: 'Repsol estacion 1234', movimiento: 'Pago con tarjeta', importe: -50 },
      { valor: '03/09/2026', concepto: 'Uber   *eats', movimiento: 'Pago con tarjeta', importe: -13.3 },
      { valor: '04/09/2026', concepto: 'Retirada en cajero bbva', importe: -60 },
      { valor: '05/09/2026', concepto: 'Comisión mantenimiento', importe: -3 },
      { valor: '06/09/2026', concepto: 'Dia sol', movimiento: 'Pago con tarjeta', importe: -12 },
      { valor: '07/09/2026', concepto: 'Media markt', movimiento: 'Pago en discos, libros, fotos y pc&#39;s', importe: -99 },
      { valor: '08/09/2026', concepto: 'Kfc', movimiento: 'Pago con tarjeta', importe: -9 },
    ]);
    expect(await categoryOf(repo, 'Abono de nómina')).toBe('Nómina');
    expect(await categoryOf(repo, 'Repsol estacion 1234')).toBe('Transporte');
    expect(await categoryOf(repo, 'Uber   *eats')).toBe('Restaurantes');
    expect(await categoryOf(repo, 'Retirada en cajero bbva')).toBe('Efectivo');
    expect(await categoryOf(repo, 'Comisión mantenimiento')).toBe('Comisiones e impuestos');
    expect(await categoryOf(repo, 'Dia sol')).toBe('Supermercado');
    expect(await categoryOf(repo, 'Media markt')).toBeNull();
    expect(await categoryOf(repo, 'Kfc')).toBeNull();
  });

  it('gives every Amazon purchase the payee "Amazon", whatever its order code', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Www.amazon*nv14y8j34', movimiento: 'Pago con tarjeta', importe: -25.99 },
      { valor: '09/09/2026', concepto: 'Www.amazon*nm1zi14p4', movimiento: 'Pago con tarjeta', importe: -8.5 },
    ]);
    const txs = await repo.listTransactions('2026-09');
    expect(txs.map((tx) => tx.payee?.name)).toEqual(['Amazon', 'Amazon']);
    expect(new Set(txs.map((tx) => tx.payeeId)).size).toBe(1);
    expect(txs.map((tx) => tx.category?.name)).toEqual(['Compras', 'Compras']);
  });

  it('leaves transactions categorized by rules as never edited', async () => {
    const repo = await setup();
    const { batch } = await importFile(repo, [{ valor: '01/09/2026', concepto: 'Mercadona', importe: -20 }]);
    const [tx] = await repo.listTransactions('2026-09');
    expect(tx.category?.name).toBe('Supermercado');
    expect(tx.editedAt).toBeNull();
    expect(await repo.editedCountInImport(batch.id)).toBe(0);
  });

  it('counts only what rules left uncategorized on Inicio', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '01/10/2026', concepto: 'Mercadona', importe: -20 },
      { valor: '02/10/2026', concepto: 'Kfc', importe: -9 },
    ]);
    expect((await repo.home('2026-10')).uncategorized).toBe(1);
  });
});

async function categoryId(repo: DataRepository, name: string) {
  const category = (await repo.listCategories()).find((c) => c.name === name);
  if (!category) throw new Error(`No category ${name}`);
  return category.id;
}

describe('import preview', () => {
  it('shows the category a rule gives each new row, or none', async () => {
    const repo = await setup();
    const { plan } = await preview(repo, [
      { valor: '01/09/2026', concepto: 'Mercadona', importe: -20 },
      { valor: '02/09/2026', concepto: 'Kfc', importe: -9 },
    ]);
    const byConcept = new Map(plan.rows.map((row) => [row.concept, row.categoryId]));
    expect(byConcept.get('Mercadona')).toBe(await categoryId(repo, 'Supermercado'));
    expect(byConcept.get('Kfc')).toBeNull();
  });
});

describe('rules on import', () => {
  it('lets the first enabled matching rule win, and a user rule before the starter rules', async () => {
    const repo = await setup();
    await repo.createRule({
      name: 'Mercadona del trabajo',
      match: { value: 'mercadona - poligono' },
      actions: { categoryId: await categoryId(repo, 'Otros gastos') },
    });
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Mercadona - poligono', importe: -20 },
      { valor: '02/09/2026', concepto: 'Mercadona - centro', importe: -30 },
    ]);
    expect(await categoryOf(repo, 'Mercadona - poligono')).toBe('Otros gastos');
    expect(await categoryOf(repo, 'Mercadona - centro')).toBe('Supermercado');
  });

  it('ignores disabled rules', async () => {
    const repo = await setup();
    const mercadona = (await repo.listRules()).find((rule) => rule.name === 'Mercadona')!;
    await repo.updateRule(mercadona.id, { enabled: false });
    await importFile(repo, [{ valor: '01/09/2026', concepto: 'Mercadona', importe: -20 }]);
    expect(await categoryOf(repo, 'Mercadona')).toBeNull();
  });

  it('matches the text in Movimiento by default, ignoring case and accents', async () => {
    const repo = await setup();
    await repo.createRule({ name: 'Alquiler', match: { value: 'Alquíler' }, actions: { categoryId: await categoryId(repo, 'Vivienda') } });
    await importFile(repo, [{ valor: '01/09/2026', concepto: 'Bizum', movimiento: 'Recibido: alquiler', importe: 400 }]);
    expect(await categoryOf(repo, 'Bizum')).toBe('Vivienda');
  });

  it('only matches charges with direction "out", and only credits with "in"', async () => {
    const repo = await setup();
    const gifts = await categoryId(repo, 'Regalos');
    const refunds = await categoryId(repo, 'Reembolsos');
    await repo.createRule({ name: 'Bizum enviado', match: { value: 'bizum', direction: 'out' }, actions: { categoryId: gifts } });
    await repo.createRule({ name: 'Bizum recibido', match: { value: 'bizum', direction: 'in' }, actions: { categoryId: refunds } });
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Bizum', movimiento: 'ENVIADO: regalo', importe: -15 },
      { valor: '02/09/2026', concepto: 'Bizum', movimiento: 'Recibido: cena', importe: 20 },
    ]);
    const txs = await repo.listTransactions('2026-09');
    expect(txs.find((tx) => tx.type === 'expense')!.category?.name).toBe('Regalos');
    expect(txs.find((tx) => tx.type === 'income')!.category?.name).toBe('Reembolsos');
  });

  it('sets a payee from a rule, reusing an existing payee with the same normalized name', async () => {
    const repo = await setup();
    await importFile(repo, [{ valor: '01/09/2026', concepto: 'Panaderia Pepe', importe: -2 }]);
    await repo.createRule({ name: 'Pepe', match: { value: 'pan pepe' }, actions: { payeeName: 'panadería pepe' } });
    await importFile(repo, [{ valor: '02/09/2026', concepto: 'Pan pepe 2', importe: -3 }]);
    const txs = await repo.listTransactions('2026-09');
    expect(new Set(txs.map((tx) => tx.payeeId)).size).toBe(1);
    expect(txs.every((tx) => tx.payee?.name === 'Panaderia Pepe')).toBe(true);
  });
});
