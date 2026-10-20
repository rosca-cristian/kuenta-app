import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository, ImportPreview } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement, type SampleFileOptions } from './support/bbvaXlsx';

let dbCount = 0;

async function setup(now = new Date('2026-10-20T10:00:00')) {
  const repo = createDexieRepository({ name: `kuenta-test-${++dbCount}`, now: () => now });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return repo;
}

async function preview(repo: DataRepository, movements: SampleMovement[], options?: SampleFileOptions): Promise<ImportPreview> {
  const result = await repo.previewImport(await bbvaXlsx(movements, options), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return result.preview;
}

async function importFile(repo: DataRepository, movements: SampleMovement[], options?: SampleFileOptions) {
  return repo.commitImport(await preview(repo, movements, options));
}

async function importAccount(repo: DataRepository) {
  return (await repo.listAccounts()).find((account) => account.isImportAccount)!;
}

const september: SampleMovement[] = [
  { valor: '01/09/2026', concepto: 'Bizum', movimiento: 'Recibido: sin concepto', importe: 11 },
  { valor: '01/09/2026', fecha: '03/09/2026', concepto: 'Kfc', movimiento: 'Pago con tarjeta', importe: -22.27 },
  { valor: '05/09/2026', fecha: '07/09/2026', concepto: 'Uber   *eats', movimiento: 'Pago con tarjeta', importe: -13.3 },
  { valor: '10/09/2026', concepto: 'Abono del inem - pago de desempleo', movimiento: 'Ingreso por nómina o pensión', importe: 1103.5 },
  { valor: '25/09/2026', concepto: 'Bizum', movimiento: 'ENVIADO: cena', importe: -25 },
  { valor: '30/09/2026', concepto: 'Cargo por amortizacion de prestamo/credito', importe: -207.33 },
];

describe('reading the BBVA file', () => {
  it('reads every row of a well-formed file', async () => {
    const repo = await setup();
    const { plan } = await preview(repo, september, { startBalance: 4036.47 });
    expect(plan.rows).toHaveLength(6);
    expect(plan.rows.every((row) => row.status === 'new')).toBe(true);
    expect(plan.dateFrom).toBe('2026-09-01');
    expect(plan.dateTo).toBe('2026-09-30');
    expect(plan.warnings).toEqual([]);
  });

  it('turns bank amounts into exact cents', async () => {
    const repo = await setup();
    const { plan } = await preview(repo, [
      { valor: '01/09/2026', concepto: 'A', importe: -207.33 },
      { valor: '02/09/2026', concepto: 'B', importe: 0.08 },
      { valor: '03/09/2026', concepto: 'C', importe: -50 },
      { valor: '04/09/2026', concepto: 'D', importe: 1103.5 },
      { valor: '05/09/2026', concepto: 'E', importe: 0.1 },
      { valor: '06/09/2026', concepto: 'F', importe: 0.2 },
    ]);
    expect(plan.rows.map((row) => row.bankAmount).sort((a, b) => a - b)).toEqual([-20733, -5000, 8, 10, 20, 110350]);
  });

  it('refuses a file with a required column missing, naming it', async () => {
    const repo = await setup();
    const result = await repo.previewImport(await bbvaXlsx(september, { omitColumns: ['Disponible'] }), 'x.xlsx');
    expect(result).toMatchObject({ ok: false, error: { code: 'missing-columns' } });
    expect(!result.ok && result.error.message).toContain('Disponible');
  });

  it('refuses a file with an amount in another currency', async () => {
    const repo = await setup();
    const result = await repo.previewImport(
      await bbvaXlsx([...september, { valor: '30/09/2026', concepto: 'Hotel', importe: -100, divisa: 'USD' }]),
      'x.xlsx',
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'currency' } });
  });

  it('refuses something that is not a spreadsheet', async () => {
    const repo = await setup();
    const result = await repo.previewImport(new TextEncoder().encode('hola').buffer as ArrayBuffer, 'x.pdf');
    expect(result).toMatchObject({ ok: false, error: { code: 'unreadable' } });
  });

  it('decodes HTML entities in bank texts', async () => {
    const repo = await setup();
    await importFile(repo, [{ valor: '01/09/2026', concepto: 'Media markt', movimiento: 'Pago en discos, libros, fotos y pc&#39;s', importe: -10 }]);
    const [tx] = await repo.listTransactions('2026-09');
    expect(tx.bankMovement).toBe("Pago en discos, libros, fotos y pc's");
  });

  it('warns when the file’s own balances don’t chain', async () => {
    const repo = await setup();
    const { plan } = await preview(repo, [
      { valor: '01/09/2026', concepto: 'A', importe: -10 },
      { valor: '05/09/2026', concepto: 'B', importe: -10, disponible: 500 },
    ]);
    expect(plan.warnings.map((warning) => warning.kind)).toContain('file-chain-broken');
  });
});

describe('importing', () => {
  it('creates one transaction per row, dated with the value date', async () => {
    const repo = await setup();
    const { batch } = await importFile(repo, september, { startBalance: 4036.47 });
    expect(batch.created).toBe(6);

    const txs = await repo.listTransactions('2026-09');
    const kfc = txs.find((tx) => tx.bankConcept === 'Kfc')!;
    expect(kfc).toMatchObject({ type: 'expense', amount: 2227, date: '2026-09-01', bookingDate: '2026-09-03', categoryId: null });
    const unemployment = txs.find((tx) => tx.amount === 110350)!;
    expect(unemployment.type).toBe('income');
  });

  it('fills the payee from the cleaned concept', async () => {
    const repo = await setup();
    await importFile(repo, september);
    const txs = await repo.listTransactions('2026-09');
    expect(txs.find((tx) => tx.amount === 1330)!.payee?.name).toBe('Uber *eats');
    expect(txs.find((tx) => tx.amount === 2227)!.payee?.name).toBe('Kfc');
  });

  it('leaves Bizum without payee and keeps its movement as the note', async () => {
    const repo = await setup();
    await importFile(repo, september);
    const bizum = (await repo.listTransactions('2026-09')).find((tx) => tx.amount === 2500)!;
    expect(bizum.payee).toBeNull();
    expect(bizum.note).toBe('ENVIADO: cena');
  });

  it('reuses payees whose names match ignoring case and accents', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Cafetería sol', importe: -2 },
      { valor: '02/09/2026', concepto: 'CAFETERIA SOL', importe: -3 },
    ]);
    const txs = await repo.listTransactions('2026-09');
    expect(new Set(txs.map((tx) => tx.payeeId)).size).toBe(1);
  });

  it('sets the opening balance so the balance equals the latest Disponible', async () => {
    const repo = await setup();
    const { check } = await importFile(repo, september, { startBalance: 4036.47 });
    const account = await importAccount(repo);
    expect(account.openingBalance).toBe(403647);
    expect(account.balance).toBe(check.bankBalance);
    expect(check).toMatchObject({ bankBalance: 488307, appBalance: 488307, difference: 0 });
  });

  it('creates nothing when the same file is imported again', async () => {
    const repo = await setup();
    await importFile(repo, september);
    const again = await preview(repo, september);
    expect(again.plan.rows.every((row) => row.status === 'already-imported')).toBe(true);
    const { batch } = await repo.commitImport(again);
    expect(batch.created).toBe(0);
    expect(await repo.listTransactions('2026-09')).toHaveLength(6);
  });

  it('imports only the new rows of an overlapping file', async () => {
    const repo = await setup();
    await importFile(repo, september.slice(0, 4));
    const { plan } = await preview(repo, september);
    expect(plan.rows.filter((row) => row.status === 'new')).toHaveLength(2);
    await repo.commitImport(await preview(repo, september));
    expect(await repo.listTransactions('2026-09')).toHaveLength(6);
    expect((await repo.balanceCheck())!.difference).toBe(0);
  });

  it('imports two otherwise identical rows when their Disponible differs', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '11/09/2026', concepto: 'Bizum', movimiento: 'Recibido: sin concepto', importe: 23 },
      { valor: '11/09/2026', concepto: 'Bizum', movimiento: 'Recibido: sin concepto', importe: 23 },
    ]);
    expect(await repo.listTransactions('2026-09')).toHaveLength(2);
  });

  it('skips excluded rows and reports the difference with the bank', async () => {
    const repo = await setup();
    const file = await preview(repo, september, { startBalance: 4036.47 });
    const uber = file.plan.rows.find((row) => row.amount === 1330)!;
    const { batch, check } = await repo.commitImport(file, { exclude: [uber.hash] });
    expect(batch.created).toBe(5);
    expect(check.difference).toBe(-1330);
    expect((await repo.home('2026-09')).gaps).toHaveLength(1);
  });

  it('recomputes the opening balance when an older month is imported', async () => {
    const repo = await setup();
    await importFile(repo, september, { startBalance: 4036.47 });
    const august = [
      { valor: '05/08/2026', concepto: 'Mercadona', importe: -40 },
      { valor: '20/08/2026', concepto: 'Gasolinera', importe: -60 },
    ];
    const older = await preview(repo, august, { startBalance: 4136.47 });
    expect(older.plan.warnings.map((warning) => warning.kind)).toContain('older-than-opening');
    const { check } = await repo.commitImport(older);
    expect((await importAccount(repo)).openingBalance).toBe(413647);
    expect(check.difference).toBe(0);
    expect((await repo.home('2026-10')).gaps).toEqual([]);
  });

  it('detects a missing week and clears the gap once it is imported', async () => {
    const repo = await setup();
    const week1 = [{ valor: '01/10/2026', concepto: 'A', importe: -10 }];
    const week2 = [{ valor: '08/10/2026', concepto: 'B', importe: -20 }];
    const week3 = [{ valor: '15/10/2026', concepto: 'C', importe: -30 }];

    await importFile(repo, week1, { startBalance: 1000 });
    const third = await preview(repo, week3, { startBalance: 970 });
    expect(third.plan.warnings).toContainEqual({ kind: 'gaps', gaps: [{ after: '2026-10-01', before: '2026-10-15' }] });
    const { check } = await repo.commitImport(third);
    expect(check.difference).toBe(-2000);
    expect((await repo.home('2026-10')).gaps).toEqual([{ after: '2026-10-01', before: '2026-10-15' }]);

    await importFile(repo, week2, { startBalance: 990 });
    expect((await repo.home('2026-10')).gaps).toEqual([]);
    expect((await repo.balanceCheck())!.difference).toBe(0);
  });

  it('creates a balance adjustment for the difference', async () => {
    const repo = await setup();
    await importFile(repo, [{ valor: '01/10/2026', concepto: 'A', importe: -10 }], { startBalance: 1000 });
    await importFile(repo, [{ valor: '15/10/2026', concepto: 'C', importe: -30 }], { startBalance: 970 });
    await repo.createBalanceAdjustment();
    expect((await repo.balanceCheck())!.difference).toBe(0);
    const adjustment = (await repo.listTransactions('2026-10')).find((tx) => tx.source === 'adjustment')!;
    expect(adjustment).toMatchObject({ type: 'expense', amount: 2000, categoryId: null, date: '2026-10-20' });
    // Adjustments don't count as spending.
    expect((await repo.home('2026-10')).summary.expenses).toBe(4000);
  });

  it('orders rows booked on the same day by following the balances', async () => {
    const repo = await setup();
    // Booked the same day; the last one in the file is the oldest.
    await importFile(repo, [
      { valor: '25/09/2026', fecha: '28/09/2026', concepto: 'A', importe: -21.78 },
      { valor: '26/09/2026', fecha: '28/09/2026', concepto: 'B', importe: 9 },
      { valor: '27/09/2026', fecha: '28/09/2026', concepto: 'C', importe: -50 },
    ], { startBalance: 2300 });
    expect((await importAccount(repo)).openingBalance).toBe(230000);
    expect((await repo.home('2026-10')).gaps).toEqual([]);
  });
});

describe('undoing an import', () => {
  it('removes the transactions it created and recomputes the opening balance', async () => {
    const repo = await setup();
    await importFile(repo, september, { startBalance: 4036.47 });
    const { batch } = await importFile(repo, [{ valor: '05/08/2026', concepto: 'Old', importe: -40 }], { startBalance: 4076.47 });
    expect((await importAccount(repo)).openingBalance).toBe(407647);

    await repo.undoImport(batch.id);
    expect(await repo.listTransactions('2026-08')).toHaveLength(0);
    expect((await importAccount(repo)).openingBalance).toBe(403647);
    expect((await repo.listImports()).find((b) => b.id === batch.id)!.undone).toBe(true);
    expect((await repo.balanceCheck())!.difference).toBe(0);
  });

  it('counts the transactions edited since, so the user can be warned', async () => {
    const repo = await setup();
    const { batch } = await importFile(repo, september);
    expect(await repo.editedCountInImport(batch.id)).toBe(0);
    const [tx] = await repo.listTransactions('2026-09');
    await repo.updateTransaction(tx.id, { note: 'cena con Ana' });
    expect(await repo.editedCountInImport(batch.id)).toBe(1);
  });
});

describe('editing transactions', () => {
  it('changes category, payee and note, reusing an existing payee', async () => {
    const repo = await setup();
    await importFile(repo, september);
    const restaurants = (await repo.listCategories()).find((c) => c.name === 'Restaurantes')!;
    const txs = await repo.listTransactions('2026-09');
    const kfc = txs.find((tx) => tx.bankConcept === 'Kfc')!;
    const uber = txs.find((tx) => tx.amount === 1330)!;

    await repo.updateTransaction(uber.id, { categoryId: restaurants.id, payeeName: 'KFC', note: 'cena' });
    const updated = (await repo.getTransaction(uber.id))!;
    expect(updated.category?.name).toBe('Restaurantes');
    expect(updated.payeeId).toBe(kfc.payeeId);
    expect(updated.note).toBe('cena');
    // Amount, date and account stay as the bank recorded them.
    expect(updated).toMatchObject({ amount: 1330, date: '2026-09-05', accountId: uber.accountId });
  });

  it('suggests the expense categories used the same day for an incoming amount', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '02/10/2026', concepto: 'Bar romera', importe: -73.5 },
      { valor: '02/10/2026', concepto: 'Bizum', movimiento: 'Recibido: cena', importe: 38.05 },
    ]);
    const restaurants = (await repo.listCategories()).find((c) => c.name === 'Restaurantes')!;
    const bar = (await repo.listTransactions('2026-10')).find((tx) => tx.amount === 7350)!;
    await repo.updateTransaction(bar.id, { categoryId: restaurants.id });
    expect(await repo.expenseCategoriesUsedOn('2026-10-02')).toEqual([restaurants.id]);
  });
});

describe('home', () => {
  it('summarizes the month and counts what needs attention', async () => {
    const repo = await setup(new Date('2026-10-20T10:00:00'));
    await importFile(repo, [
      { valor: '01/10/2026', concepto: 'Nómina', importe: 1000 },
      { valor: '02/10/2026', concepto: 'Mercadona', importe: -200 },
      { valor: '03/10/2026', concepto: 'Bar', importe: -50 },
    ], { startBalance: 500 });
    const home = await repo.home('2026-10');
    expect(home.summary).toEqual({ income: 100000, expenses: 25000, savings: 75000, savingsRate: 0.75 });
    expect(home.totalBalance).toBe(125000);
    expect(home.uncategorized).toBe(3);
    expect(home.daysSinceLastImport).toBe(0);
  });

  it('shows no savings rate without income', async () => {
    const repo = await setup();
    await importFile(repo, [{ valor: '02/10/2026', concepto: 'Mercadona', importe: -20 }]);
    expect((await repo.home('2026-10')).summary.savingsRate).toBeNull();
  });

  it('reports the days since the last import', async () => {
    let now = new Date('2026-10-01T09:00:00');
    const repo = createDexieRepository({ name: `kuenta-test-${++dbCount}`, now: () => now });
    await repo.completeOnboarding({ importAccountName: 'BBVA' });
    expect((await repo.home('2026-10')).daysSinceLastImport).toBeNull();
    await importFile(repo, [{ valor: '01/10/2026', concepto: 'A', importe: -1 }]);
    now = new Date('2026-10-09T23:00:00');
    expect((await repo.home('2026-10')).daysSinceLastImport).toBe(8);
  });
});
