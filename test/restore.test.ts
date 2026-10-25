import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import { KuentaDb } from '../src/data/dexie/db';
import type { DataRepository } from '../src/data/repository';
import { backupJson, type BackupFile } from '../src/domain/backup';
import { importFile, richData, transactionId } from './support/backupData';

let dbCount = 0;

/** A repository on its own database, onboarded unless `fresh`, whose clock reads 20 October 2026 and can move on. */
async function setup({ fresh = false } = {}) {
  const name = `kuenta-restore-test-${++dbCount}`;
  const clock = { now: new Date('2026-10-20T10:00:00') };
  const repo = createDexieRepository({ name, now: () => clock.now, appVersion: '1.2.3' });
  if (!fresh) await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return { repo, clock, db: new KuentaDb(name) };
}

const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

/** Every table of the database, rows sorted, settings by key. */
async function tables(db: KuentaDb) {
  return {
    accounts: byId(await db.accounts.toArray()),
    categories: byId(await db.categories.toArray()),
    payees: byId(await db.payees.toArray()),
    transactions: byId(await db.transactions.toArray()),
    rules: byId(await db.rules.toArray()),
    budgetLimits: byId(await db.budgetLimits.toArray()),
    goals: byId(await db.goals.toArray()),
    importBatches: byId(await db.importBatches.toArray()),
    settings: Object.fromEntries((await db.settings.toArray()).map((setting) => [setting.key, setting.value])),
  };
}

/** A rich backup made on 20 October 2026, as JSON text. */
async function richBackup() {
  const source = await setup();
  await richData(source.repo);
  const backup = await source.repo.exportBackup();
  return { source, backup, text: backupJson(backup) };
}

function read(repo: DataRepository, text: string): BackupFile {
  const result = repo.readBackup(text);
  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.backup;
}

/** The backup's JSON with `change` applied to its parsed object. */
function edited(text: string, change: (file: { data: Record<string, Record<string, unknown>[]> } & Record<string, unknown>) => void) {
  const file = JSON.parse(text);
  change(file);
  return JSON.stringify(file);
}

describe('restoring a backup', () => {
  it('brings back every table field for field into a fresh app', async () => {
    const { source, text } = await richBackup();
    const target = await setup({ fresh: true });
    await target.repo.restoreBackup(read(target.repo, text));

    const [before, after] = [await tables(source.db), await tables(target.db)];
    for (const table of ['accounts', 'categories', 'payees', 'transactions', 'rules', 'budgetLimits', 'goals', 'importBatches'] as const) {
      expect(after[table], table).toEqual(before[table]);
    }
    const { importAccountId, starterDataVersion, onboardingDone } = before.settings;
    expect(after.settings).toEqual({
      importAccountId,
      starterDataVersion,
      onboardingDone,
      lastBackupAt: new Date('2026-10-20T10:00:00').toISOString(),
      lastChangeAt: new Date('2026-10-20T10:00:00').toISOString(),
    });
    // What the screens show agrees too.
    expect((await target.repo.home('2026-10')).totalBalance).toBe((await source.repo.home('2026-10')).totalBalance);
    expect(await target.repo.getSettings()).toEqual({ onboardingDone: true, importAccountId, persistRequested: false });
  });

  it('replaces different data without leaving anything of it, keeping only whether persistence was requested', async () => {
    const { text } = await richBackup();
    const target = await setup();
    await importFile(target.repo, [{ valor: '15/09/2026', concepto: 'Otro banco', movimiento: 'Pago con tarjeta', importe: -7 }], 300);
    await target.repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'green' });
    await target.repo.createRule({ name: 'Otro', match: { value: 'otro' }, actions: { payeeName: 'Otro' } });
    await target.repo.setPersistRequested();
    target.clock.now = new Date('2026-10-24T08:00:00');
    await target.repo.markBackupMade();
    await target.db.settings.put({ key: 'lastChangeAt', value: '2026-10-23T08:00:00.000Z' });

    let changes = 0;
    target.repo.subscribe(() => changes++);
    const backup = read(target.repo, text);
    await target.repo.restoreBackup(backup);
    expect(changes).toBe(1);

    const after = await tables(target.db);
    expect(after.accounts.map((account) => account.id).sort()).toEqual(backup.data.accounts.map((account) => account.id).sort());
    expect(after.transactions).toEqual(byId(backup.data.transactions));
    expect(after.transactions.some((tx) => tx.bankConcept === 'Otro banco')).toBe(false);
    expect(after.rules).toEqual(byId(backup.data.rules));
    expect(after.categories).toEqual(byId(backup.data.categories));
    expect(after.importBatches).toEqual(byId(backup.data.importBatches));
    expect(after.payees).toEqual(byId(backup.data.payees));
    expect(after.settings.persistRequested).toBe(true);
    expect(after.settings.lastBackupAt).toBe(backup.exportedAt);
    expect(after.settings.lastChangeAt).toBe(backup.exportedAt);
    expect(after.settings.importAccountId).toBe(backup.data.settings.find((s) => s.key === 'importAccountId')!.value);
  });

  it('ignores device settings a backup carries', async () => {
    const { text } = await richBackup();
    const target = await setup({ fresh: true });
    const withDevice = edited(text, (file) => {
      file.data.settings.push({ key: 'persistRequested', value: true }, { key: 'lastBackupAt', value: '2020-01-01T00:00:00.000Z' });
    });
    await target.repo.restoreBackup(read(target.repo, withDevice));
    const { settings } = await tables(target.db);
    expect(settings.persistRequested).toBeUndefined();
    expect(settings.lastBackupAt).toBe(new Date('2026-10-20T10:00:00').toISOString());
  });

  it('still lets rules skip the transactions edited by hand', async () => {
    const { text } = await richBackup();
    const target = await setup({ fresh: true });
    await target.repo.restoreBackup(read(target.repo, text));

    const fuel = (await target.repo.listCategories()).find((c) => c.name === 'Compras')!.id;
    await target.repo.createRule({ name: 'Todo', match: { value: 'a' }, actions: { categoryId: fuel } });
    await target.repo.applyRules();
    const mercadona = await target.repo.getTransaction(await transactionId(target.repo, 'Mercadona - crta del inge'));
    expect(mercadona!.category!.name).toBe('Supermercado');
    expect(mercadona!.note).toBe('compra semanal');
    const bakery = await target.repo.getTransaction(await transactionId(target.repo, 'Panaderia Pepe'));
    expect(bakery!.category!.name).toBe('Compras');
  });

  it("doesn't remind to make a backup right after restoring one, only after the next change", async () => {
    const { backup, text } = await richBackup();
    const target = await setup({ fresh: true });
    target.clock.now = new Date('2026-11-20T10:00:00');
    await target.repo.restoreBackup(read(target.repo, text));
    expect(await target.repo.backupStatus()).toEqual({ lastBackupAt: backup.exportedAt, due: false });
    expect((await target.repo.home('2026-11')).backupDue).toBe(false);

    await target.repo.updateTransaction(await transactionId(target.repo, 'Panaderia Pepe'), { note: 'pan' });
    expect((await target.repo.backupStatus()).due).toBe(true);
  });
});

describe('reading a backup', () => {
  it("summarizes the copy's date and counts, and counts the current data the same way", async () => {
    const { source, text } = await richBackup();
    const result = source.repo.readBackup(text);
    expect(result.ok && result.summary).toEqual({
      exportedAt: new Date('2026-10-20T10:00:00').toISOString(),
      accounts: 2,
      transactions: 5,
      categories: (await source.repo.listCategories({ withArchived: true })).length,
      payees: (await source.repo.listPayees()).length,
      rules: (await source.repo.listRules()).length,
      budgets: 1,
      goals: 1,
    });
    expect(result.ok && { exportedAt: result.summary.exportedAt, ...(await source.repo.dataCounts()) }).toEqual(result.ok && result.summary);
  });

  const refusals: [string, (text: string) => string, unknown][] = [
    ['text that is not JSON', () => 'Fecha;Tipo;Cuenta\n20/10/2026;Gasto;BBVA', { reason: 'not-kuenta' }],
    ['JSON from another app', (text) => edited(text, (file) => void (file.app = 'otra')), { reason: 'not-kuenta' }],
    ['a newer format', (text) => edited(text, (file) => void (file.format = 2)), { reason: 'newer' }],
    [
      'a wrong type in a table',
      (text) => edited(text, (file) => void (file.data.transactions[1].amount = '12,50')),
      { reason: 'damaged', damage: { kind: 'invalid', table: 'transactions', row: 1, field: 'amount' } },
    ],
    [
      'amounts that are not whole cents',
      (text) => edited(text, (file) => void (file.data.accounts[0].openingBalance = 12.5)),
      { reason: 'damaged', damage: { kind: 'invalid', table: 'accounts', row: 0, field: 'openingBalance' } },
    ],
    [
      'a missing table',
      (text) => edited(text, (file) => void delete file.data.goals),
      { reason: 'damaged', damage: { kind: 'invalid', table: 'goals', row: null, field: null } },
    ],
    [
      'a transaction pointing at a missing account',
      (text) => edited(text, (file) => void (file.data.transactions[0].accountId = 'no-such-account')),
      { reason: 'damaged', damage: { kind: 'reference', table: 'transactions', field: 'accountId', target: 'accounts' } },
    ],
    [
      'a duplicate importHash',
      (text) => edited(text, (file) => void (file.data.transactions[1].importHash = file.data.transactions.find((tx) => tx.importHash && tx !== file.data.transactions[1])!.importHash)),
      { reason: 'damaged', damage: { kind: 'duplicate', table: 'transactions', field: 'importHash' } },
    ],
    [
      'a duplicate id',
      (text) => edited(text, (file) => void (file.data.rules[1].id = file.data.rules[0].id)),
      { reason: 'damaged', damage: { kind: 'duplicate', table: 'rules', field: 'id' } },
    ],
    [
      'a goal on a missing account',
      (text) => edited(text, (file) => void (file.data.goals[0].accountId = 'no-such-account')),
      { reason: 'damaged', damage: { kind: 'reference', table: 'goals', field: 'accountId', target: 'accounts' } },
    ],
    [
      'an import account that is not in the copy',
      (text) => edited(text, (file) => void (file.data.settings.find((s) => s.key === 'importAccountId')!.value = 'no-such-account')),
      { reason: 'damaged', damage: { kind: 'reference', table: 'settings', field: 'importAccountId', target: 'accounts' } },
    ],
  ];

  it.each(refusals)('refuses %s, leaving the data untouched', async (_, damage, error) => {
    const { text } = await richBackup();
    const target = await setup();
    await importFile(target.repo, [{ valor: '15/09/2026', concepto: 'Otro banco', movimiento: 'Pago con tarjeta', importe: -7 }], 300);
    const before = await tables(target.db);

    const result = target.repo.readBackup(damage(text));
    expect(result).toEqual({ ok: false, error });
    expect(await tables(target.db)).toEqual(before);
  });
});
