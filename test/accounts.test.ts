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
    const { repo, name } = await setup();
    await repo.createAccount({ ...revolut, openingBalance: 50000 });
    await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'pink', openingBalance: 12345 });
    // Archiving comes with its own screen; until then, archive it in the database directly.
    const db = new KuentaDb(name);
    await db.accounts.filter((account) => account.name === 'Hucha').modify({ archived: true });
    db.close();

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
