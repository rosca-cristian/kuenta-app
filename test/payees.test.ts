import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

async function setup(now = () => new Date('2026-10-20T10:00:00')) {
  const repo = createDexieRepository({ name: `kuenta-payees-test-${++dbCount}`, now });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return repo;
}

async function importFile(repo: DataRepository, movements: SampleMovement[]) {
  const result = await repo.previewImport(await bbvaXlsx(movements), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return repo.commitImport(result.preview);
}

const october: SampleMovement[] = [
  { valor: '01/10/2026', concepto: 'Www.ebay*nv14y8j34', movimiento: 'Pago con tarjeta', importe: -19.99 },
  { valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -42.1 },
  { valor: '03/10/2026', concepto: 'Www.ebay*nm1zi14p4', movimiento: 'Pago con tarjeta', importe: -7.5 },
  { valor: '04/10/2026', concepto: 'Ebay', movimiento: 'Pago con tarjeta', importe: -12 },
  { valor: '05/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -30 },
  { valor: '06/10/2026', concepto: 'Bizum', movimiento: 'Recibido: cena', importe: 15 },
];

async function payeeNamed(repo: DataRepository, name: string) {
  const payee = (await repo.listPayees()).find((p) => p.name === name);
  if (!payee) throw new Error(`No payee named ${name}`);
  return payee;
}

describe('listing payees', () => {
  it('lists every payee by name with its number of transactions', async () => {
    const repo = await setup();
    await importFile(repo, october);
    const payees = await repo.listPayees();
    expect(payees.map(({ name, transactionCount }) => [name, transactionCount])).toEqual([
      ['Ebay', 1],
      ['Mercadona', 2],
      ['Www.ebay*nm1zi14p4', 1],
      ['Www.ebay*nv14y8j34', 1],
    ]);
  });
});

describe('renaming a payee', () => {
  it('shows the new name on every one of its transactions', async () => {
    const repo = await setup();
    await importFile(repo, october);
    const mercadona = await payeeNamed(repo, 'Mercadona');

    expect(await repo.renamePayee(mercadona.id, '  Mercadona   Almería ')).toEqual({ ok: true });

    const txs = (await repo.listTransactions('2026-10')).filter((tx) => tx.payeeId === mercadona.id);
    expect(txs.map((tx) => tx.payee?.name)).toEqual(['Mercadona Almería', 'Mercadona Almería']);
    expect((await repo.listPayees()).map((p) => p.name)).toContain('Mercadona Almería');
  });

  it('refuses a name another payee already has, ignoring case and accents', async () => {
    const repo = await setup();
    await importFile(repo, [...october, { valor: '07/10/2026', concepto: 'Cafetería sol', importe: -2 }]);
    const ebay = await payeeNamed(repo, 'Ebay');
    const order = await payeeNamed(repo, 'Www.ebay*nv14y8j34');
    const mercadona = await payeeNamed(repo, 'Mercadona');

    expect(await repo.renamePayee(order.id, ' ÉBAY ')).toMatchObject({
      ok: false,
      reason: 'exists',
      existing: { id: ebay.id, name: 'Ebay' },
    });
    expect(await repo.renamePayee(mercadona.id, 'cafeteria  SOL')).toMatchObject({ ok: false, reason: 'exists' });
    expect((await repo.listPayees()).map((p) => p.name)).toEqual([
      'Cafetería Sol',
      'Ebay',
      'Mercadona',
      'Www.ebay*nm1zi14p4',
      'Www.ebay*nv14y8j34',
    ]);
  });

  it('allows changing only the case or accents of its own name', async () => {
    const repo = await setup();
    await importFile(repo, october);
    const mercadona = await payeeNamed(repo, 'Mercadona');
    expect(await repo.renamePayee(mercadona.id, 'MERCADONA')).toEqual({ ok: true });
    expect((await repo.getTransaction((await repo.listTransactions('2026-10')).find((tx) => tx.payeeId === mercadona.id)!.id))?.payee?.name).toBe('MERCADONA');
  });

  it('refuses an empty name', async () => {
    const repo = await setup();
    await importFile(repo, october);
    const mercadona = await payeeNamed(repo, 'Mercadona');
    expect(await repo.renamePayee(mercadona.id, '   ')).toEqual({ ok: false, reason: 'empty' });
    expect((await repo.listPayees()).map((p) => p.name)).toContain('Mercadona');
  });
});

describe('merging payees', () => {
  it('moves every transaction to the kept payee and removes the others', async () => {
    const repo = await setup();
    await importFile(repo, october);
    const ebay = await payeeNamed(repo, 'Ebay');
    const orders = [await payeeNamed(repo, 'Www.ebay*nv14y8j34'), await payeeNamed(repo, 'Www.ebay*nm1zi14p4')];

    await repo.mergePayees(ebay.id, orders.map((p) => p.id));

    expect((await repo.listPayees()).map(({ name, transactionCount }) => [name, transactionCount])).toEqual([
      ['Ebay', 3],
      ['Mercadona', 2],
    ]);
    const ebayTxs = (await repo.listTransactions('2026-10')).filter((tx) => tx.bankConcept?.toLowerCase().includes('ebay'));
    expect(ebayTxs.map((tx) => tx.payee?.name)).toEqual(['Ebay', 'Ebay', 'Ebay']);
  });

  it('keeps the category, note and edited marker of the moved transactions, and every balance', async () => {
    let clock = new Date('2026-10-20T10:00:00');
    const repo = await setup(() => clock);
    await importFile(repo, october);
    const shopping = (await repo.listCategories()).find((c) => c.name === 'Compras')!;
    const ebay = await payeeNamed(repo, 'Ebay');
    const order = await payeeNamed(repo, 'Www.ebay*nv14y8j34');
    const [edited] = (await repo.listTransactions('2026-10')).filter((tx) => tx.payeeId === order.id);
    await repo.updateTransaction(edited.id, { categoryId: shopping.id, note: 'cascos' });
    const before = (await repo.getTransaction(edited.id))!;
    const accountsBefore = await repo.listAccounts();
    const untouched = (await repo.listTransactions('2026-10')).find((tx) => tx.bankConcept === 'Www.ebay*nm1zi14p4')!;

    clock = new Date('2026-10-21T18:30:00');
    await repo.mergePayees(ebay.id, [order.id, (await payeeNamed(repo, 'Www.ebay*nm1zi14p4')).id]);

    const after = (await repo.getTransaction(edited.id))!;
    expect(after.payee?.name).toBe('Ebay');
    expect(after).toMatchObject({ categoryId: shopping.id, note: 'cascos', editedAt: before.editedAt, amount: 1999, date: '2026-10-01' });
    expect((await repo.getTransaction(untouched.id))!).toMatchObject({ categoryId: null, note: '', editedAt: null });
    expect((await repo.listAccounts()).map((a) => a.balance)).toEqual(accountsBefore.map((a) => a.balance));
    expect((await repo.balanceCheck())!.difference).toBe(0);
  });

  it('merges into the payee that already has the name a rename was refused for', async () => {
    const repo = await setup();
    await importFile(repo, october);
    const order = await payeeNamed(repo, 'Www.ebay*nv14y8j34');
    const refused = await repo.renamePayee(order.id, 'ebay');
    if (refused.ok || refused.reason !== 'exists') throw new Error('Expected the rename to be refused');

    await repo.mergePayees(refused.existing.id, [order.id]);

    expect((await repo.listPayees()).map(({ name, transactionCount }) => [name, transactionCount])).toEqual([
      ['Ebay', 2],
      ['Mercadona', 2],
      ['Www.ebay*nm1zi14p4', 1],
    ]);
  });

  it('changes nothing when the kept payee no longer exists', async () => {
    const repo = await setup();
    await importFile(repo, october);
    const before = await repo.listPayees();
    const order = await payeeNamed(repo, 'Www.ebay*nv14y8j34');

    await expect(repo.mergePayees('missing', [order.id])).rejects.toThrow();

    expect(await repo.listPayees()).toEqual(before);
  });
});

describe('payees set by rules', () => {
  const amazon: SampleMovement[] = [{ valor: '01/10/2026', concepto: 'Www.amazon*nv14y8j34', movimiento: 'Pago con tarjeta', importe: -10 }];
  const later: SampleMovement[] = [{ valor: '09/10/2026', concepto: 'Www.amazon*zz99', movimiento: 'Pago con tarjeta', importe: -5 }];

  it('keeps a rule’s payee in step when the payee is renamed', async () => {
    const repo = await setup();
    await importFile(repo, amazon);
    await repo.renamePayee((await payeeNamed(repo, 'Amazon')).id, 'Amazon.es');
    await importFile(repo, later);
    expect((await repo.listPayees()).map((p) => [p.name, p.transactionCount])).toEqual([['Amazon.es', 2]]);
  });

  it('keeps a rule’s payee in step when the payee is merged into another', async () => {
    const repo = await setup();
    await importFile(repo, [...amazon, { valor: '02/10/2026', concepto: 'Compras online', importe: -3 }]);
    await repo.mergePayees((await payeeNamed(repo, 'Compras Online')).id, [(await payeeNamed(repo, 'Amazon')).id]);
    await importFile(repo, later);
    expect((await repo.listPayees()).map((p) => [p.name, p.transactionCount])).toEqual([['Compras Online', 3]]);
  });
});
