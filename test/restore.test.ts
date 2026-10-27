import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import { KuentaDb } from '../src/data/dexie/db';
import type { DataRepository } from '../src/data/repository';
import { backupFieldName, backupJson, type BackupFile } from '../src/domain/backup';
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
    reimbursements: byId(await db.reimbursements.toArray()),
    settings: Object.fromEntries((await db.settings.toArray()).map((setting) => [setting.key, setting.value])),
  };
}

/** A rich backup made on 20 October 2026, as JSON text. */
async function richBackup() {
  const source = await setup();
  await richData(source.repo, source.db);
  const backup = await source.repo.exportBackup();
  return { source, backup, text: backupJson(backup) };
}

function read(repo: DataRepository, text: string): BackupFile {
  const result = repo.readBackup(text);
  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.backup;
}

/** The id of the backup's transaction with this bank concept. */
const txWith = (file: { data: Record<string, Record<string, unknown>[]> }, concept: string) =>
  file.data.transactions.find((tx) => tx.bankConcept === concept)!.id as string;

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
    const all = ['accounts', 'categories', 'payees', 'transactions', 'rules', 'budgetLimits', 'goals', 'importBatches', 'reimbursements'] as const;
    for (const table of all) {
      expect(after[table], table).toEqual(before[table]);
    }
    expect(after.reimbursements).toHaveLength(1);
    const { importAccountId, starterDataVersion, starterRulesOffer, onboardingDone } = before.settings;
    expect(starterRulesOffer).toBe('done');
    expect(after.settings).toEqual({
      importAccountId,
      starterDataVersion,
      starterRulesOffer,
      onboardingDone,
      lastBackupAt: new Date('2026-10-20T10:00:00').toISOString(),
      lastChangeAt: new Date('2026-10-20T10:00:00').toISOString(),
    });
    // What the screens show agrees too.
    expect((await target.repo.home('2026-10')).totalBalance).toBe((await source.repo.home('2026-10')).totalBalance);
    expect(await target.repo.listGoals()).toEqual(await source.repo.listGoals());
    expect(await target.repo.listRules()).toEqual(await source.repo.listRules());
    expect(await target.repo.listCategories({ withArchived: true })).toEqual(await source.repo.listCategories({ withArchived: true }));
    expect(await target.repo.listTransactions(null)).toEqual(await source.repo.listTransactions(null));
    expect(await target.repo.spending('2026-10')).toEqual(await source.repo.spending('2026-10'));
    expect(await target.repo.getSettings()).toEqual({ onboardingDone: true, importAccountId, persistRequested: false, privacyMode: false });
  });

  it("sets up a new phone from the first-run screen: onboarding done with the backup's import account", async () => {
    const { source, backup, text } = await richBackup();
    const target = await setup({ fresh: true });
    expect((await target.repo.getSettings()).onboardingDone).toBe(false);

    // What the welcome screen does: restore, then request persistent storage as "Empezar" does.
    await target.repo.restoreBackup(read(target.repo, text));
    await target.repo.setPersistRequested();

    const importAccountId = backup.data.settings.find((s) => s.key === 'importAccountId')!.value;
    expect(await target.repo.getSettings()).toEqual({ onboardingDone: true, importAccountId, persistRequested: true, privacyMode: false });
    expect(await target.repo.listAccounts()).toEqual(await source.repo.listAccounts());
    expect(await target.repo.listTransactions(null)).toEqual(await source.repo.listTransactions(null));
    // No starter data of its own: the categories are exactly the backup's.
    expect(byId(await target.db.categories.toArray())).toEqual(byId(backup.data.categories));
  });

  it("replaces different data without leaving anything of it, keeping this phone's own settings", async () => {
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
    expect(after.reimbursements).toEqual(byId(backup.data.reimbursements));
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

  it("keeps any setting of this phone's that isn't data, and never sends the app back to the first run", async () => {
    const { text } = await richBackup();
    const target = await setup();
    await target.db.settings.put({ key: 'privacyMode', value: true });
    const notDone = edited(text, (file) => {
      file.data.settings = file.data.settings.filter((row) => row.key !== 'onboardingDone');
    });
    await target.repo.restoreBackup(read(target.repo, notDone));
    const { settings } = await tables(target.db);
    expect(settings.privacyMode).toBe(true);
    expect((await target.repo.getSettings()).onboardingDone).toBe(true);
  });

  it('lists a restored archived category only with `withArchived`, after the active ones', async () => {
    // Archiving a category isn't offered: a backup is how the repository gets one.
    const { text } = await richBackup();
    const target = await setup({ fresh: true });
    // Besides the rich data's "Antigua", the last one, one from the middle of the order.
    const withRegalos = edited(text, (file) => void (file.data.categories.find((c) => c.name === 'Regalos')!.archived = true));
    await target.repo.restoreBackup(read(target.repo, withRegalos));

    const active = await target.repo.listCategories();
    expect(active.map((c) => c.name)).not.toContain('Regalos');
    expect(active.map((c) => c.name)).not.toContain('Antigua');
    expect(active.every((c, i) => i === 0 || active[i - 1].order <= c.order)).toBe(true);
    const all = await target.repo.listCategories({ withArchived: true });
    expect(all.map((c) => c.name)).toEqual([...active.map((c) => c.name), 'Regalos', 'Antigua']);
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
      accounts: 3,
      transactions: 6,
      categories: (await source.repo.listCategories({ withArchived: true })).length,
      payees: (await source.repo.listPayees()).length,
      rules: (await source.repo.listRules()).length,
      budgets: 1,
      goals: 3,
      reimbursements: 1,
    });
    expect(result.ok && { exportedAt: result.summary.exportedAt, ...(await source.repo.dataCounts()) }).toEqual(result.ok && result.summary);
  });

  const refusals: [string, (text: string) => string, unknown][] = [
    ['text that is not JSON', () => 'Fecha;Tipo;Cuenta\n20/10/2026;Gasto;BBVA', { reason: 'not-kuenta' }],
    ['JSON from another app', (text) => edited(text, (file) => void (file.app = 'otra')), { reason: 'not-kuenta' }],
    ['a newer format', (text) => edited(text, (file) => void (file.format = 3)), { reason: 'newer' }],
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
    [
      'a reimbursement of a missing transaction',
      (text) => edited(text, (file) => void (file.data.reimbursements[0].expenseId = 'no-such-transaction')),
      { reason: 'damaged', damage: { kind: 'reference', table: 'reimbursements', field: 'expenseId', target: 'transactions' } },
    ],
    [
      'a reimbursement by something other than an imported income',
      (text) => edited(text, (file) => void (file.data.reimbursements[0].incomeId = txWith(file, 'Panaderia Pepe'))),
      { reason: 'damaged', damage: { kind: 'invalid', table: 'reimbursements', row: 0, field: 'incomeId' } },
    ],
    [
      'a reimbursement of something other than an imported expense',
      (text) => edited(text, (file) => void (file.data.reimbursements[0].expenseId = txWith(file, 'Revolut**5625*'))),
      { reason: 'damaged', damage: { kind: 'invalid', table: 'reimbursements', row: 0, field: 'expenseId' } },
    ],
    [
      'a reimbursement of a balance adjustment',
      (text) =>
        edited(text, (file) => void (file.data.reimbursements[0].expenseId = file.data.transactions.find((tx) => tx.source === 'adjustment')!.id as string)),
      { reason: 'damaged', damage: { kind: 'invalid', table: 'reimbursements', row: 0, field: 'expenseId' } },
    ],
    [
      'parts above the income',
      (text) => edited(text, (file) => void (file.data.reimbursements[0].amount = 201)),
      { reason: 'damaged', damage: { kind: 'invalid', table: 'reimbursements', row: 0, field: 'amount' } },
    ],
    [
      'parts above the expense, across incomes',
      (text) =>
        edited(text, (file) => {
          // The salary pays back the rest of the bread, and a cent more.
          const link = file.data.reimbursements[0];
          file.data.reimbursements.push({ id: 'otro', incomeId: txWith(file, 'Abono de nómina'), expenseId: link.expenseId, amount: 171 });
        }),
      { reason: 'damaged', damage: { kind: 'invalid', table: 'reimbursements', row: 1, field: 'amount' } },
    ],
    [
      'a part of 0',
      (text) => edited(text, (file) => void (file.data.reimbursements[0].amount = 0)),
      { reason: 'damaged', damage: { kind: 'invalid', table: 'reimbursements', row: 0, field: 'amount' } },
    ],
    [
      'two links of the same income and expense',
      (text) => edited(text, (file) => void file.data.reimbursements.push({ ...file.data.reimbursements[0], id: 'otro', amount: 1 })),
      { reason: 'damaged', damage: { kind: 'duplicate', table: 'reimbursements', field: 'incomeId+expenseId' } },
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

  it('restores a format 1 copy, made before reimbursements, with none', async () => {
    const { source, backup } = await richBackup();
    // What Kuenta wrote before format 2: the same tables but reimbursements.
    const { reimbursements, ...data } = backup.data;
    expect(reimbursements).toHaveLength(1);
    const formatOne = JSON.stringify({ ...backup, format: 1, data }, null, 2);

    // A phone with links of its own: restoring the copy leaves none.
    const target = await setup();
    await richData(target.repo, target.db);
    expect(await target.db.reimbursements.count()).toBe(1);
    const result = target.repo.readBackup(formatOne);
    expect(result.ok && result.backup).toEqual({ ...backup, format: 2, data: { ...backup.data, reimbursements: [] } });
    expect(result.ok && result.summary.reimbursements).toBe(0);
    await target.repo.restoreBackup(read(target.repo, formatOne));
    const after = await tables(target.db);
    expect(after.transactions).toEqual(byId(backup.data.transactions));
    expect(after.reimbursements).toEqual([]);
    const bakery = await transactionId(target.repo, 'Panaderia Pepe');
    expect((await target.repo.getTransaction(bakery))!.reimbursement).toBeNull();
    expect((await source.repo.getTransaction(bakery))!.reimbursement).toMatchObject({ paidBack: 150 });
  });

  it("counts a setting's row among all the file's settings, the ones it doesn't restore included", async () => {
    const { source, text } = await richBackup();
    let row = -1;
    const damaged = edited(text, (file) => {
      file.data.settings.unshift({ key: 'persistRequested', value: true }, { key: 'lastBackupAt', value: '2026-10-01T00:00:00.000Z' });
      row = file.data.settings.findIndex((s) => s.key === 'starterDataVersion');
      file.data.settings[row].value = 'uno';
    });
    expect(row).toBeGreaterThan(1);
    expect(source.repo.readBackup(damaged)).toEqual({
      ok: false,
      error: { reason: 'damaged', damage: { kind: 'invalid', table: 'settings', row, field: 'value' } },
    });
  });

  it('names in Spanish every field a damaged copy can point at', async () => {
    const { backup } = await richBackup();
    const fields = new Set<string>(['app', 'format', 'exportedAt', 'appVersion', 'data', 'key', 'value']);
    for (const rows of Object.values(backup.data) as Record<string, unknown>[][]) {
      for (const row of rows) {
        for (const [key, value] of Object.entries(row)) {
          fields.add(key);
          if (typeof value === 'object' && value !== null) Object.keys(value).forEach((nested) => fields.add(`${key}.${nested}`));
        }
      }
    }
    for (const setting of backup.data.settings) fields.add(setting.key);
    // Spelled the same in Spanish.
    const same = new Set(['app', 'color']);
    for (const field of fields) expect(same.has(field) || backupFieldName(field) !== field, field).toBe(true);
    expect(backupFieldName('amount')).toBe('importe');
    expect(backupFieldName('match.value')).toBe('texto de la condición');
    expect(backupFieldName('somethingElse')).toBe('somethingElse');
  });
});
