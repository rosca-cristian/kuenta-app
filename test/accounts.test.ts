import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import { KuentaDb } from '../src/data/dexie/db';
import type { DataRepository } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

async function setup() {
  const name = `kuenta-accounts-test-${++dbCount}`;
  const repo = createDexieRepository({ name, now: () => new Date('2026-10-20T10:00:00') });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return { repo, name };
}

async function importFile(repo: DataRepository, movements: SampleMovement[], startBalance = 1000) {
  const result = await repo.previewImport(await bbvaXlsx(movements, { startBalance }), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return repo.commitImport(result.preview);
}

async function accountNamed(repo: DataRepository, name: string) {
  const account = (await repo.listAccounts()).find((a) => a.name === name);
  if (!account) throw new Error(`No account named ${name}`);
  return account;
}

const revolut = { name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' } as const;

describe('creating a non-imported account', () => {
  it('adds it after the existing accounts, with its look and its opening balance as balance', async () => {
    const { repo } = await setup();

    const result = await repo.createAccount({ ...revolut, name: '  Revolut ', openingBalance: 50000 });

    const created = await accountNamed(repo, 'Revolut');
    expect(result).toEqual({ ok: true, id: created.id });
    expect(created).toMatchObject({
      type: 'bank',
      icon: 'banknote',
      color: 'cyan',
      archived: false,
      openingBalance: 50000,
      balance: 50000,
      isImportAccount: false,
    });
    expect((await repo.listAccounts()).map((a) => a.name)).toEqual(['BBVA', 'Revolut']);

    await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'pink' });
    expect((await repo.listAccounts()).map((a) => a.name)).toEqual(['BBVA', 'Revolut', 'Hucha']);
  });

  it('defaults the opening balance to 0 and accepts a negative one', async () => {
    const { repo } = await setup();

    await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'pink' });
    await repo.createAccount({ name: 'Tarjeta', type: 'other', icon: 'receipt', color: 'red', openingBalance: -12050 });

    expect(await accountNamed(repo, 'Hucha')).toMatchObject({ openingBalance: 0, balance: 0 });
    expect(await accountNamed(repo, 'Tarjeta')).toMatchObject({ openingBalance: -12050, balance: -12050 });
  });

  it('refuses an empty name, or one another account has ignoring case and accents', async () => {
    const { repo } = await setup();
    await repo.createAccount({ ...revolut, name: 'Inversión' });
    const before = await repo.listAccounts();

    expect(await repo.createAccount({ ...revolut, name: '   ' })).toEqual({ ok: false, reason: 'empty' });
    expect(await repo.createAccount({ ...revolut, name: ' bbva ' })).toMatchObject({
      ok: false,
      reason: 'exists',
      existing: { id: before[0].id, name: 'BBVA' },
    });
    expect(await repo.createAccount({ ...revolut, name: 'INVERSION' })).toMatchObject({
      ok: false,
      reason: 'exists',
      existing: { name: 'Inversión' },
    });
    expect(await repo.listAccounts()).toEqual(before);
  });
});

describe('editing an account', () => {
  it("changes a non-imported account's name, type, icon, colour and opening balance, and so its balance", async () => {
    const { repo } = await setup();
    const { id } = (await repo.createAccount({ ...revolut, openingBalance: 50000 })) as { id: string };

    expect(
      await repo.updateAccount(id, { name: ' Ahorro  Revolut ', type: 'savings', icon: 'piggy-bank', color: 'green', openingBalance: -2550 }),
    ).toEqual({ ok: true, id });

    expect(await accountNamed(repo, 'Ahorro Revolut')).toMatchObject({
      type: 'savings',
      icon: 'piggy-bank',
      color: 'green',
      openingBalance: -2550,
      balance: -2550,
    });
    await repo.updateAccount(id, { color: 'cyan' });
    expect(await accountNamed(repo, 'Ahorro Revolut')).toMatchObject({ type: 'savings', color: 'cyan', balance: -2550 });
  });

  it("changes the import account's name and look, but not its opening balance, which still follows imports", async () => {
    const { repo } = await setup();
    await importFile(repo, [{ valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -42.1 }], 1000);
    const bbva = await accountNamed(repo, 'BBVA');

    expect(await repo.updateAccount(bbva.id, { name: 'Cuenta BBVA', type: 'savings', icon: 'home', color: 'purple' })).toEqual({
      ok: true,
      id: bbva.id,
    });
    await expect(repo.updateAccount(bbva.id, { name: 'Otro nombre', openingBalance: 0 })).rejects.toThrow();

    expect(await accountNamed(repo, 'Cuenta BBVA')).toMatchObject({
      isImportAccount: true,
      type: 'savings',
      icon: 'home',
      color: 'purple',
      openingBalance: 100000,
      balance: 95790,
    });
    // An older import still moves the opening balance, and the balance check still agrees.
    await importFile(repo, [{ valor: '01/09/2026', concepto: 'Lidl', movimiento: 'Pago con tarjeta', importe: -10 }], 1010);
    expect(await accountNamed(repo, 'Cuenta BBVA')).toMatchObject({ openingBalance: 101000, balance: 95790 });
    expect((await repo.balanceCheck())?.difference).toBe(0);
  });

  it('allows changing only the case or accents of its own name', async () => {
    const { repo } = await setup();
    const bbva = await accountNamed(repo, 'BBVA');
    expect(await repo.updateAccount(bbva.id, { name: 'Bbva' })).toEqual({ ok: true, id: bbva.id });
    expect((await repo.listAccounts()).map((a) => a.name)).toEqual(['Bbva']);
  });

  it('refuses an empty name, or one another account has', async () => {
    const { repo } = await setup();
    const { id } = (await repo.createAccount({ ...revolut, openingBalance: 50000 })) as { id: string };
    const before = await repo.listAccounts();

    expect(await repo.updateAccount(id, { name: ' ', openingBalance: 0 })).toEqual({ ok: false, reason: 'empty' });
    expect(await repo.updateAccount(id, { name: 'bbvá', openingBalance: 0 })).toMatchObject({
      ok: false,
      reason: 'exists',
      existing: { name: 'BBVA' },
    });
    expect(await repo.listAccounts()).toEqual(before);
  });
});

describe('accounts on Inicio', () => {
  it('lists the non-archived accounts, telling the import account apart', async () => {
    const { repo } = await setup();
    await importFile(repo, [{ valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -42.1 }], 1000);
    await repo.createAccount({ ...revolut, openingBalance: 50000 });

    const { accounts, totalBalance } = await repo.home('2026-10');

    expect(accounts.map(({ name, balance, isImportAccount }) => ({ name, balance, isImportAccount }))).toEqual([
      { name: 'BBVA', balance: 95790, isImportAccount: true },
      { name: 'Revolut', balance: 50000, isImportAccount: false },
    ]);
    expect(totalBalance).toBe(145790);
  });

  it('counts archived accounts in the total balance but leaves them out of the list', async () => {
    const { repo } = await setup();
    await repo.createAccount({ ...revolut, openingBalance: 50000 });
    await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'pink', openingBalance: 12345 });
    await repo.setAccountArchived((await accountNamed(repo, 'Hucha')).id, true);

    const home = await repo.home('2026-10');

    expect(home.accounts.map((a) => a.name)).toEqual(['BBVA', 'Revolut']);
    expect(home.totalBalance).toBe(62345);
    expect((await repo.listAccounts()).map((a) => [a.name, a.archived])).toEqual([
      ['BBVA', false],
      ['Revolut', false],
      ['Hucha', true],
    ]);
  });
});

describe('Actualizar saldo on a non-imported account', () => {
  it('creates a balance adjustment dated today for the difference, so the balance becomes the typed one', async () => {
    const { repo } = await setup();
    const { id } = (await repo.createAccount({ ...revolut, openingBalance: 70000 })) as { id: string };

    expect(await repo.updateAccountBalance(id, 65000)).toBe(-5000);

    expect(await accountNamed(repo, 'Revolut')).toMatchObject({ balance: 65000, transactionCount: 1 });
    const [adjustment] = await repo.listTransactions('2026-10');
    expect(adjustment).toMatchObject({
      type: 'expense',
      amount: 5000,
      date: '2026-10-20',
      accountId: id,
      toAccountId: null,
      categoryId: null,
      payeeId: null,
      note: 'Ajuste de saldo',
      source: 'adjustment',
    });

    // Up again: an income for the new difference, from the adjusted balance.
    expect(await repo.updateAccountBalance(id, 80000)).toBe(15000);
    expect(await accountNamed(repo, 'Revolut')).toMatchObject({ balance: 80000, transactionCount: 2 });
    expect((await repo.listTransactions('2026-10')).map((tx) => [tx.type, tx.amount])).toContainEqual(['income', 15000]);
  });

  it('creates nothing when the account already has that balance', async () => {
    const { repo } = await setup();
    const { id } = (await repo.createAccount({ ...revolut, openingBalance: 70000 })) as { id: string };

    expect(await repo.updateAccountBalance(id, 70000)).toBe(0);

    expect(await repo.listTransactions('2026-10')).toEqual([]);
    expect(await accountNamed(repo, 'Revolut')).toMatchObject({ balance: 70000, transactionCount: 0 });
  });

  it("is refused on the import account, whose balance comes from the bank", async () => {
    const { repo } = await setup();
    await importFile(repo, [{ valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -42.1 }], 1000);
    const bbva = await accountNamed(repo, 'BBVA');

    await expect(repo.updateAccountBalance(bbva.id, 100000)).rejects.toThrow();
    await expect(repo.updateAccountBalance('missing', 100000)).rejects.toThrow();

    expect(await repo.listTransactions('2026-10')).toHaveLength(1);
    expect(await accountNamed(repo, 'BBVA')).toMatchObject({ balance: 95790 });
    expect((await repo.balanceCheck())?.difference).toBe(0);
  });

  it("never counts as income or expense, and deleting it from its edit sheet undoes it", async () => {
    const { repo } = await setup();
    await importFile(
      repo,
      [
        { valor: '01/10/2026', concepto: 'Nomina', movimiento: 'Abono de nomina', importe: 2000 },
        { valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -500 },
      ],
      1000,
    );
    const { id } = (await repo.createAccount({ ...revolut, openingBalance: 70000 })) as { id: string };
    const before = await repo.home('2026-10');

    await repo.updateAccountBalance(id, 65000);
    await repo.updateAccountBalance(id, 90000);

    const after = await repo.home('2026-10');
    expect(after.summary).toEqual(before.summary);
    expect(after.summary).toMatchObject({ income: 200000, expenses: 50000 });
    expect(after.uncategorized).toBe(before.uncategorized);
    expect(after.totalBalance).toBe(before.totalBalance + 20000);
    expect((await repo.balanceCheck())?.difference).toBe(0);

    const adjustments = (await repo.listTransactions('2026-10')).filter((tx) => tx.source === 'adjustment');
    expect(adjustments.map((tx) => tx.account.name)).toEqual(['Revolut', 'Revolut']);
    for (const adjustment of adjustments) await repo.deleteAdjustment(adjustment.id);
    expect(await accountNamed(repo, 'Revolut')).toMatchObject({ balance: 70000, transactionCount: 0 });
  });

  it('refuses an amount that is not whole cents', async () => {
    const { repo } = await setup();
    const { id } = (await repo.createAccount({ ...revolut, openingBalance: 70000 })) as { id: string };

    await expect(repo.updateAccountBalance(id, 650.5)).rejects.toThrow();

    expect(await repo.listTransactions('2026-10')).toEqual([]);
  });
});

describe('archiving an account', () => {
  it("hides it from Inicio's list until unarchived, while its transactions stay listed and its balance still counts", async () => {
    const { repo } = await setup();
    const { id } = (await repo.createAccount({ ...revolut, openingBalance: 70000 })) as { id: string };
    await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'pink' });
    await repo.updateAccountBalance(id, 65000);

    await repo.setAccountArchived(id, true);

    expect(await accountNamed(repo, 'Revolut')).toMatchObject({ archived: true, balance: 65000 });
    const archivedHome = await repo.home('2026-10');
    expect(archivedHome.accounts.map((a) => a.name)).toEqual(['BBVA', 'Hucha']);
    expect(archivedHome.totalBalance).toBe(65000);
    expect((await repo.listTransactions('2026-10')).map((tx) => tx.account.name)).toEqual(['Revolut']);

    await repo.setAccountArchived(id, false);

    expect(await accountNamed(repo, 'Revolut')).toMatchObject({ archived: false });
    expect((await repo.home('2026-10')).accounts.map((a) => a.name)).toEqual(['BBVA', 'Revolut', 'Hucha']);
  });

  it('is refused for the import account', async () => {
    const { repo } = await setup();
    const bbva = await accountNamed(repo, 'BBVA');

    await expect(repo.setAccountArchived(bbva.id, true)).rejects.toThrow();
    await expect(repo.setAccountArchived('missing', true)).rejects.toThrow();

    expect(await accountNamed(repo, 'BBVA')).toMatchObject({ archived: false });
    expect((await repo.home('2026-10')).accounts.map((a) => a.name)).toEqual(['BBVA']);
  });
});

describe('deleting an account', () => {
  it('deletes a non-imported account with no transactions', async () => {
    const { repo } = await setup();
    const { id } = (await repo.createAccount({ ...revolut, openingBalance: 70000 })) as { id: string };
    await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'pink' });

    await repo.deleteAccount(id);

    expect((await repo.listAccounts()).map((a) => a.name)).toEqual(['BBVA', 'Hucha']);
    expect((await repo.home('2026-10')).totalBalance).toBe(0);
  });

  it('is refused while the account has transactions, on either side', async () => {
    const { repo, name } = await setup();
    const { id: revolutId } = (await repo.createAccount({ ...revolut, openingBalance: 70000 })) as { id: string };
    const { id: huchaId } = (await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'pink' })) as {
      id: string;
    };
    await repo.updateAccountBalance(revolutId, 65000);
    await importFile(repo, [{ valor: '02/10/2026', concepto: 'Traspaso a hucha', movimiento: 'Transferencia', importe: -10 }], 1000);
    // Converting into a transfer comes with its own ticket; until then, convert it in the database directly.
    const db = new KuentaDb(name);
    await db.transactions.filter((tx) => tx.source === 'import').modify({ type: 'transfer', toAccountId: huchaId, categoryId: null });
    db.close();
    expect(await accountNamed(repo, 'Hucha')).toMatchObject({ transactionCount: 1, balance: 1000 });
    const before = await repo.listAccounts();

    await expect(repo.deleteAccount(revolutId)).rejects.toThrow();
    await expect(repo.deleteAccount(huchaId)).rejects.toThrow();

    expect(await repo.listAccounts()).toEqual(before);
  });

  it('is refused for the import account, even with no transactions', async () => {
    const { repo } = await setup();
    const bbva = await accountNamed(repo, 'BBVA');

    await expect(repo.deleteAccount(bbva.id)).rejects.toThrow();
    await expect(repo.deleteAccount('missing')).rejects.toThrow();

    expect((await repo.listAccounts()).map((a) => a.name)).toEqual(['BBVA']);
  });
});
