import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository } from '../src/data/repository';
import { transactionsCsv } from '../src/domain/csv';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

/** The clock reads Tuesday 20 October 2026, as in the other repository tests. */
async function setup() {
  const repo = createDexieRepository({ name: `kuenta-csv-test-${++dbCount}`, now: () => new Date('2026-10-20T10:00:00') });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  const { id: revolutId } = (await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string };
  return { repo, revolutId };
}

async function importFile(repo: DataRepository, movements: SampleMovement[]) {
  const result = await repo.previewImport(await bbvaXlsx(movements, { startBalance: 1000 }), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return repo.commitImport(result.preview);
}

async function transactionId(repo: DataRepository, concept: string) {
  const tx = (await repo.listTransactions('2026-10')).find((t) => t.bankConcept === concept);
  if (!tx) throw new Error(`No transaction ${concept}`);
  return tx.id;
}

/** Two Mercadona charges on the same day, so the bank's order matters. */
const october: SampleMovement[] = [
  { valor: '01/10/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
  { valor: '02/10/2026', concepto: 'Mercadona - crta del inge', movimiento: 'Pago con tarjeta', importe: -50 },
  { valor: '02/10/2026', concepto: 'Mercadona; Valencia', movimiento: 'Pago con tarjeta', importe: -12.5 },
  { valor: '05/10/2026', concepto: 'Revolut**5625*', movimiento: 'Pago con tarjeta', importe: -200 },
];

describe('exporting Movimientos as CSV', () => {
  it('writes what listTransactions returns, filtered or not, with the transfer and the balance adjustment', async () => {
    const { repo, revolutId } = await setup();
    await importFile(repo, october);
    const groceries = (await repo.listCategories()).find((c) => c.name === 'Supermercado')!.id;
    await repo.updateTransaction(await transactionId(repo, 'Mercadona - crta del inge'), { categoryId: groceries, payeeName: 'Mercadona', note: '=compra' });
    await repo.updateTransaction(await transactionId(repo, 'Mercadona; Valencia'), { categoryId: groceries, payeeName: 'Mercadona' });
    await repo.updateTransaction(await transactionId(repo, 'Revolut**5625*'), { transferAccountId: revolutId });
    // Revolut has the 200 € top-up; it really has 180 €: an adjustment of −20 € today.
    await repo.updateAccountBalance(revolutId, 18000);

    const all = transactionsCsv(await repo.listTransactions('2026-10'));
    expect(all.split('\r\n')).toEqual([
      '\uFEFFFecha;Tipo;Cuenta;Cuenta destino;Categoría;Comercio;Nota;Importe;Concepto banco',
      '01/10/2026;Ingreso;BBVA;;Nómina;Abono De Nómina;;1500,00;Abono de nómina',
      `02/10/2026;Gasto;BBVA;;Supermercado;Mercadona;'=compra;-50,00;Mercadona - crta del inge`,
      '02/10/2026;Gasto;BBVA;;Supermercado;Mercadona;;-12,50;"Mercadona; Valencia"',
      '05/10/2026;Transferencia;BBVA;Revolut;;Revolut**5625*;;-200,00;Revolut**5625*',
      '20/10/2026;Ajuste de saldo;Revolut;;;;Ajuste de saldo;-20,00;',
      '',
    ]);

    const filtered = transactionsCsv(await repo.listTransactions('2026-10', { categoryId: groceries }));
    expect(filtered.split('\r\n').slice(1)).toEqual([
      `02/10/2026;Gasto;BBVA;;Supermercado;Mercadona;'=compra;-50,00;Mercadona - crta del inge`,
      '02/10/2026;Gasto;BBVA;;Supermercado;Mercadona;;-12,50;"Mercadona; Valencia"',
      '',
    ]);
  });

  it('keeps the bank order within a day when a filter leaves out the rows in between', async () => {
    const { repo } = await setup();
    await importFile(repo, [
      { valor: '02/10/2026', concepto: 'Tienda A', movimiento: 'Pago con tarjeta', importe: -1 },
      { valor: '02/10/2026', concepto: 'Otra', movimiento: 'Pago con tarjeta', importe: -2 },
      { valor: '02/10/2026', concepto: 'Tienda B', movimiento: 'Pago con tarjeta', importe: -3 },
      { valor: '02/10/2026', concepto: 'Otra 2', movimiento: 'Pago con tarjeta', importe: -4 },
      { valor: '02/10/2026', concepto: 'Tienda C', movimiento: 'Pago con tarjeta', importe: -5 },
    ]);
    const concepts = (csv: string) => csv.split('\r\n').slice(1, -1).map((line) => line.split(';')[8]);

    // Movimientos lists the newest first, in the bank's order, filtered or not.
    expect((await repo.listTransactions('2026-10')).map((tx) => tx.bankConcept)).toEqual(['Tienda C', 'Otra 2', 'Tienda B', 'Otra', 'Tienda A']);
    const shops = await repo.listTransactions('2026-10', { text: 'tienda' });
    expect(shops.map((tx) => tx.bankConcept)).toEqual(['Tienda C', 'Tienda B', 'Tienda A']);
    expect(concepts(transactionsCsv(shops))).toEqual(['Tienda A', 'Tienda B', 'Tienda C']);
  });
});

describe('exporting a date range as CSV', () => {
  /** Three months, with two rows on the range's first day and one on its last. */
  const history: SampleMovement[] = [
    { valor: '31/08/2026', concepto: 'Antes', movimiento: 'Pago con tarjeta', importe: -1 },
    { valor: '01/09/2026', concepto: 'Inicio A', movimiento: 'Pago con tarjeta', importe: -2 },
    { valor: '01/09/2026', concepto: 'Inicio B', movimiento: 'Pago con tarjeta', importe: -3 },
    { valor: '15/09/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
    { valor: '02/10/2026', concepto: 'Fin', movimiento: 'Pago con tarjeta', importe: -4 },
    { valor: '03/10/2026', concepto: 'Después', movimiento: 'Pago con tarjeta', importe: -5 },
  ];
  const concepts = (txs: { bankConcept: string | null }[]) => txs.map((tx) => tx.bankConcept);

  it('includes both ends of the range, across months, and combines with the other filters', async () => {
    const { repo } = await setup();
    await importFile(repo, history);

    const range = await repo.listTransactions(null, { from: '2026-09-01', to: '2026-10-02' });
    expect(concepts(range)).toEqual(['Fin', 'Abono de nómina', 'Inicio B', 'Inicio A']);
    expect(concepts(await repo.listTransactions(null, { from: '2026-10-02' }))).toEqual(['Después', 'Fin']);
    expect(concepts(await repo.listTransactions(null, { to: '2026-08-31' }))).toEqual(['Antes']);
    expect(concepts(await repo.listTransactions(null, { from: '2026-09-01', to: '2026-09-01' }))).toEqual(['Inicio B', 'Inicio A']);
    expect(concepts(await repo.listTransactions(null, { from: '2026-09-01', to: '2026-10-02', type: 'income' }))).toEqual(['Abono de nómina']);
    expect(concepts(await repo.listTransactions('2026-09', { to: '2026-09-01' }))).toEqual(['Inicio B', 'Inicio A']);
  });

  it('finds nothing in a range without transactions or an inverted one', async () => {
    const { repo } = await setup();
    await importFile(repo, history);
    expect(await repo.listTransactions(null, { from: '2026-09-02', to: '2026-09-14' })).toEqual([]);
    expect(await repo.listTransactions(null, { from: '2026-10-02', to: '2026-09-01' })).toEqual([]);
  });

  it('writes the range oldest first in the bank order within a day, without counting as a backup', async () => {
    const { repo } = await setup();
    await importFile(repo, history);
    const csv = transactionsCsv(await repo.listTransactions(null, { from: '2026-09-01', to: '2026-10-02' }));
    expect(csv.split('\r\n')).toEqual([
      '﻿Fecha;Tipo;Cuenta;Cuenta destino;Categoría;Comercio;Nota;Importe;Concepto banco',
      '01/09/2026;Gasto;BBVA;;;Inicio A;;-2,00;Inicio A',
      '01/09/2026;Gasto;BBVA;;;Inicio B;;-3,00;Inicio B',
      '15/09/2026;Ingreso;BBVA;;Nómina;Abono De Nómina;;1500,00;Abono de nómina',
      '02/10/2026;Gasto;BBVA;;;Fin;;-4,00;Fin',
      '',
    ]);
    expect((await repo.backupStatus()).lastBackupAt).toBeNull();
  });
});
