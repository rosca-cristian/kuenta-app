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
    const { importAccountId } = await repo.getSettings();

    const all = transactionsCsv(await repo.listTransactions('2026-10'), importAccountId);
    expect(all.split('\r\n')).toEqual([
      '\uFEFFFecha;Tipo;Cuenta;Cuenta destino;Categoría;Comercio;Nota;Importe;Concepto banco',
      '01/10/2026;Ingreso;BBVA;;Nómina;Abono De Nómina;;1500,00;Abono de nómina',
      `02/10/2026;Gasto;BBVA;;Supermercado;Mercadona;'=compra;-50,00;Mercadona - crta del inge`,
      '02/10/2026;Gasto;BBVA;;Supermercado;Mercadona;;-12,50;"Mercadona; Valencia"',
      '05/10/2026;Transferencia;BBVA;Revolut;;Revolut**5625*;;-200,00;Revolut**5625*',
      '20/10/2026;Ajuste de saldo;Revolut;;;;Ajuste de saldo;-20,00;',
      '',
    ]);

    const filtered = transactionsCsv(await repo.listTransactions('2026-10', { categoryId: groceries }), importAccountId);
    expect(filtered.split('\r\n').slice(1)).toEqual([
      `02/10/2026;Gasto;BBVA;;Supermercado;Mercadona;'=compra;-50,00;Mercadona - crta del inge`,
      '02/10/2026;Gasto;BBVA;;Supermercado;Mercadona;;-12,50;"Mercadona; Valencia"',
      '',
    ]);
  });
});
