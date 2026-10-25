import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import { KuentaDb } from '../src/data/dexie/db';
import type { DataRepository } from '../src/data/repository';
import { backupJson } from '../src/domain/backup';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

/** The clock reads Tuesday 20 October 2026, as in the other repository tests, and can move on. */
async function setup() {
  const name = `kuenta-backup-test-${++dbCount}`;
  const clock = { now: new Date('2026-10-20T10:00:00') };
  const repo = createDexieRepository({ name, now: () => clock.now, appVersion: '1.2.3' });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return { repo, clock, db: new KuentaDb(name) };
}

async function importFile(repo: DataRepository, movements: SampleMovement[], startBalance: number) {
  const result = await repo.previewImport(await bbvaXlsx(movements, { startBalance }), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return repo.commitImport(result.preview);
}

async function transactionId(repo: DataRepository, concept: string) {
  const tx = (await repo.listTransactions(null)).find((t) => t.bankConcept === concept);
  if (!tx) throw new Error(`No transaction ${concept}`);
  return tx.id;
}

/**
 * Data touching every table: an import with categorizations, a note and a renamed payee; a
 * rule applied to it; a transfer to a non-imported account and a balance adjustment there; a
 * budget with two limits; a goal; and a second import, undone.
 */
async function richData(repo: DataRepository) {
  await importFile(
    repo,
    [
      { valor: '01/10/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
      { valor: '02/10/2026', concepto: 'Mercadona - crta del inge', movimiento: 'Pago con tarjeta', importe: -50 },
      { valor: '03/10/2026', concepto: 'Panaderia Pepe', movimiento: 'Pago con tarjeta', importe: -3.2 },
      { valor: '05/10/2026', concepto: 'Revolut**5625*', movimiento: 'Pago con tarjeta', importe: -200 },
    ],
    1000,
  );
  const categories = await repo.listCategories();
  const groceries = categories.find((c) => c.name === 'Supermercado')!.id;
  const { id: revolutId } = (await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string };

  const mercadona = await transactionId(repo, 'Mercadona - crta del inge');
  await repo.updateTransaction(mercadona, { categoryId: groceries, payeeName: 'Mercadona', note: 'compra semanal' });
  const payee = (await repo.listPayees()).find((p) => p.name === 'Mercadona')!;
  await repo.renamePayee(payee.id, 'Mercadona SA');
  await repo.createRule({ name: 'Pan', match: { value: 'panaderia' }, actions: { categoryId: groceries, payeeName: 'Panadería Pepe' } });
  await repo.applyRules();
  await repo.updateTransaction(await transactionId(repo, 'Revolut**5625*'), { transferAccountId: revolutId });
  // Revolut got 200 €; it really has 180 €: an adjustment of −20 € today.
  await repo.updateAccountBalance(revolutId, 18000);
  await repo.setBudgetLimit(groceries, 30000, '2026-09');
  await repo.setBudgetLimit(groceries, 25000, '2026-10');
  await repo.createGoal({ name: 'Viaje', target: 100000, targetMonth: '2027-06', accountId: revolutId, icon: 'plane', color: 'cyan' });

  const second = await importFile(repo, [{ valor: '10/10/2026', concepto: 'Gasolinera', movimiento: 'Pago con tarjeta', importe: -40 }], 2246.8);
  await repo.undoImport(second.batch.id);
}

describe('exporting a backup', () => {
  it('has every table as stored, field for field, stamped with the clock and the version', async () => {
    const { repo, db } = await setup();
    await richData(repo);

    const backup = await repo.exportBackup();
    expect(backup).toMatchObject({ app: 'kuenta', format: 1, exportedAt: new Date('2026-10-20T10:00:00').toISOString(), appVersion: '1.2.3' });
    expect(backup.data.accounts).toEqual(await db.accounts.toArray());
    expect(backup.data.categories).toEqual(await db.categories.toArray());
    expect(backup.data.payees).toEqual(await db.payees.toArray());
    expect(backup.data.transactions).toEqual(await db.transactions.toArray());
    expect(backup.data.rules).toEqual(await db.rules.toArray());
    expect(backup.data.budgetLimits).toEqual(await db.budgetLimits.toArray());
    expect(backup.data.goals).toEqual(await db.goals.toArray());
    expect(backup.data.importBatches).toEqual(await db.importBatches.toArray());

    // What the data holds, to be sure the rich data really reached every table.
    expect(backup.data.accounts.map((a) => a.name).sort()).toEqual(['BBVA', 'Revolut']);
    expect(backup.data.payees.map((p) => p.name)).toContain('Mercadona SA');
    const types = backup.data.transactions.map((tx) => `${tx.source}:${tx.type}:${tx.amount}:${tx.editedAt === null ? 'rules' : 'edited'}`);
    expect(types.sort()).toEqual([
      'adjustment:expense:2000:rules',
      'import:expense:320:rules',
      'import:expense:5000:edited',
      'import:income:150000:rules',
      'import:transfer:20000:edited',
    ]);
    expect(backup.data.transactions.find((tx) => tx.bankConcept === 'Mercadona - crta del inge')!.note).toBe('compra semanal');
    expect(backup.data.rules.some((rule) => rule.name === 'Pan')).toBe(true);
    expect(backup.data.budgetLimits.map((limit) => [limit.fromMonth, limit.amount]).sort()).toEqual([['2026-09', 30000], ['2026-10', 25000]]);
    expect(backup.data.goals.map((goal) => goal.name)).toEqual(['Viaje']);
    expect(backup.data.importBatches.map((batch) => batch.undone).sort()).toEqual([false, true]);
  });

  it("keeps the data settings and leaves out the device's", async () => {
    const { repo, db } = await setup();
    await richData(repo);
    await repo.setPersistRequested();
    await repo.markBackupMade();
    await db.settings.bulkPut([
      { key: 'starterRulesOffer', value: 'done' },
      { key: 'lastChangeAt', value: '2026-10-19T08:00:00.000Z' },
    ]);
    const importAccountId = (await repo.getSettings()).importAccountId;

    const { settings } = (await repo.exportBackup()).data;
    expect(Object.fromEntries(settings.map((setting) => [setting.key, setting.value]))).toEqual({
      importAccountId,
      starterDataVersion: (await db.settings.get('starterDataVersion'))!.value,
      starterRulesOffer: 'done',
      onboardingDone: true,
    });
  });

  it('writes plain JSON with 2-space indentation that reads back as the same backup', async () => {
    const { repo } = await setup();
    await richData(repo);
    const backup = await repo.exportBackup();

    const json = backupJson(backup);
    expect(json.startsWith('{\n  "app": "kuenta",\n  "format": 1,\n')).toBe(true);
    expect(JSON.parse(json)).toEqual(backup);
  });
});

describe('the last backup', () => {
  it('is never until a backup is made, then the time of the latest one', async () => {
    const { repo, clock } = await setup();
    expect(await repo.backupStatus()).toEqual({ lastBackupAt: null, due: false });

    // Exporting alone isn't a backup: the file may never reach the user.
    await repo.exportBackup();
    expect((await repo.backupStatus()).lastBackupAt).toBeNull();

    let changes = 0;
    repo.subscribe(() => changes++);
    await repo.markBackupMade();
    expect(changes).toBe(1);
    expect(await repo.backupStatus()).toEqual({ lastBackupAt: new Date('2026-10-20T10:00:00').toISOString(), due: false });

    clock.now = new Date('2026-10-27T09:30:00');
    await repo.markBackupMade();
    expect((await repo.backupStatus()).lastBackupAt).toBe(new Date('2026-10-27T09:30:00').toISOString());
  });
});

describe('the backup reminder', () => {
  const october = [{ valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -12.5 }];
  const due = async (repo: DataRepository) => {
    const [home, status] = await Promise.all([repo.home('2026-10'), repo.backupStatus()]);
    expect(home.backupDue).toBe(status.due);
    return status.due;
  };

  it("doesn't show without data, even after onboarding", async () => {
    const { repo, clock } = await setup();
    expect(await due(repo)).toBe(false);
    clock.now = new Date('2026-11-20T10:00:00');
    expect(await due(repo)).toBe(false);
  });

  it('shows after an import when no backup was ever made', async () => {
    const { repo } = await setup();
    await importFile(repo, october, 1000);
    expect(await due(repo)).toBe(true);
  });

  it('goes away right after a backup, and comes back more than 7 days later only after a change', async () => {
    const { repo, clock } = await setup();
    await importFile(repo, october, 1000);
    await repo.markBackupMade();
    expect(await due(repo)).toBe(false);

    // A change the same week isn't enough: the last backup is recent.
    clock.now = new Date('2026-10-22T10:00:00');
    await repo.createAccount({ name: 'Efectivo', type: 'other', icon: 'wallet', color: 'green' });
    expect(await due(repo)).toBe(false);

    // 7 days to the minute is not more than 7.
    clock.now = new Date('2026-10-27T10:00:00');
    expect(await due(repo)).toBe(false);
    clock.now = new Date('2026-10-28T10:00:00');
    expect(await due(repo)).toBe(true);
  });

  it("doesn't show 8 days after a backup when nothing changed since", async () => {
    const { repo, clock } = await setup();
    await importFile(repo, october, 1000);
    await repo.markBackupMade();
    clock.now = new Date('2026-10-28T10:00:00');
    expect(await due(repo)).toBe(false);

    await repo.updateTransaction(await transactionId(repo, 'Mercadona'), { note: 'compra' });
    expect(await due(repo)).toBe(true);
  });

  it("doesn't count settings-only writes as changes", async () => {
    const { repo, clock, db } = await setup();
    await importFile(repo, october, 1000);
    await repo.markBackupMade();
    await db.settings.put({ key: 'starterRulesOffer', value: 'pending' });
    clock.now = new Date('2026-10-28T10:00:00');

    let notified = 0;
    repo.subscribe(() => notified++);
    await repo.setPersistRequested();
    await repo.dismissStarterRulesOffer();
    await repo.markBackupMade();
    clock.now = new Date('2026-11-10T10:00:00');
    expect(notified).toBe(3);
    expect(await due(repo)).toBe(false);
    expect((await db.settings.get('lastChangeAt'))!.value).toBe(new Date('2026-10-20T10:00:00').toISOString());
  });

  it('records every kind of change to the data, with the clock', async () => {
    const { repo, clock, db } = await setup();
    let minute = 0;
    /** Moves the clock on a minute, runs the write and checks it recorded the change at that time. */
    const records = async (write: () => Promise<unknown>) => {
      clock.now = new Date(`2026-10-20T11:${String(++minute).padStart(2, '0')}:00`);
      await write();
      expect((await db.settings.get('lastChangeAt'))?.value, `write ${minute}`).toBe(clock.now.toISOString());
    };

    let batchId = '';
    await records(async () => (batchId = (await importFile(repo, october, 1000)).batch.id));
    await records(() => repo.undoImport(batchId));
    await records(() => importFile(repo, [...october, { valor: '03/10/2026', concepto: 'Panaderia Pepe', movimiento: 'Pago con tarjeta', importe: -3.2 }], 1000));
    const mercadona = await transactionId(repo, 'Mercadona');
    await records(() => repo.updateTransaction(mercadona, { note: 'compra' }));

    let categoryId = '';
    await records(async () => (categoryId = ((await repo.createCategory({ name: 'Mascotas', kind: 'expense', icon: 'dog', color: 'amber' })) as { id: string }).id));
    await records(() => repo.updateCategory(categoryId, { name: 'Perro' }));
    await records(() => repo.moveCategory(categoryId, 'up'));
    await records(() => repo.setBudgetLimit(categoryId, 5000));

    let ruleId = '';
    await records(async () => (ruleId = await repo.createRule({ name: 'Pan', match: { value: 'panaderia' }, actions: { categoryId } })));
    await records(() => repo.updateRule(ruleId, { name: 'Panadería' }));
    await records(() => repo.moveRule(ruleId, 'down'));
    await records(() => repo.applyRules(ruleId));
    await records(() => repo.deleteRule(ruleId));
    await records(() => repo.deleteCategory(categoryId, null));

    const payee = (await repo.listPayees()).find((p) => p.name === 'Mercadona')!;
    await records(() => repo.renamePayee(payee.id, 'Mercadona SA'));
    const other = (await repo.listPayees()).find((p) => p.name !== 'Mercadona SA')!;
    await records(() => repo.mergePayees(payee.id, [other.id]));

    let accountId = '';
    await records(async () => (accountId = ((await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string }).id));
    await records(() => repo.updateAccount(accountId, { name: 'Revolut EUR' }));
    await records(() => repo.updateAccountBalance(accountId, 5000));
    const adjustment = (await repo.listTransactions(null)).find((tx) => tx.source === 'adjustment')!;
    await records(() => repo.deleteAdjustment(adjustment.id));

    let goalId = '';
    await records(async () => (goalId = ((await repo.createGoal({ name: 'Viaje', target: 100000, accountId, icon: 'plane', color: 'cyan' })) as { id: string }).id));
    await records(() => repo.updateGoal(goalId, { name: 'Viaje a Roma' }));
    await records(() => repo.setGoalArchived(goalId, true));
    await records(() => repo.deleteGoal(goalId));
    await records(() => repo.setAccountArchived(accountId, true));
    await records(() => repo.deleteAccount(accountId));
  });
});
