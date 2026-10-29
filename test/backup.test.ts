import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import { KuentaDb } from '../src/data/dexie/db';
import type { DataRepository } from '../src/data/repository';
import { backupJson } from '../src/domain/backup';
import { importFile, richData, transactionId } from './support/backupData';

let dbCount = 0;

/** The clock reads Tuesday 20 October 2026, as in the other repository tests, and can move on. */
async function setup() {
  const name = `kuenta-backup-test-${++dbCount}`;
  const clock = { now: new Date('2026-10-20T10:00:00') };
  const repo = createDexieRepository({ name, now: () => clock.now, appVersion: '1.2.3' });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return { repo, clock, db: new KuentaDb(name) };
}

describe('exporting a backup', () => {
  it('has every table as stored, field for field, stamped with the clock and the version', async () => {
    const { repo, db } = await setup();
    await richData(repo, db);

    const backup = await repo.exportBackup();
    expect(backup).toMatchObject({ app: 'kuenta', format: 3, exportedAt: new Date('2026-10-20T10:00:00').toISOString(), appVersion: '1.2.3' });
    expect(backup.data.accounts).toEqual(await db.accounts.toArray());
    expect(backup.data.categories).toEqual(await db.categories.toArray());
    expect(backup.data.payees).toEqual(await db.payees.toArray());
    expect(backup.data.transactions).toEqual(await db.transactions.toArray());
    expect(backup.data.rules).toEqual(await db.rules.toArray());
    expect(backup.data.budgetLimits).toEqual(await db.budgetLimits.toArray());
    expect(backup.data.goals).toEqual(await db.goals.toArray());
    expect(backup.data.importBatches).toEqual(await db.importBatches.toArray());
    expect(backup.data.reimbursements).toEqual(await db.reimbursements.toArray());
    expect(backup.data.savingsTargets).toEqual(await db.savingsTargets.toArray());

    // What the data holds, to be sure the rich data really reached every table.
    expect(backup.data.accounts.map((a) => `${a.name}:${a.archived}`).sort()).toEqual(['BBVA:false', 'Hucha:true', 'Revolut:false']);
    expect(backup.data.categories.find((c) => c.name === 'Antigua')!.archived).toBe(true);
    expect(backup.data.payees.map((p) => p.name)).toContain('Mercadona SA');
    const types = backup.data.transactions.map((tx) => `${tx.source}:${tx.type}:${tx.amount}:${tx.editedAt === null ? 'rules' : 'edited'}`);
    expect(types.sort()).toEqual([
      'adjustment:expense:2000:rules',
      'import:expense:320:rules',
      'import:expense:5000:edited',
      'import:income:150000:rules',
      'import:income:200:rules',
      'import:transfer:20000:edited',
    ]);
    expect(backup.data.transactions.find((tx) => tx.bankConcept === 'Mercadona - crta del inge')!.note).toBe('compra semanal');
    expect(backup.data.rules.some((rule) => rule.name === 'Pan')).toBe(true);
    const hucha = backup.data.accounts.find((a) => a.name === 'Hucha')!.id;
    expect(backup.data.rules.find((rule) => rule.name === 'A la hucha')).toMatchObject({ enabled: true, actions: { transferAccountId: hucha } });
    expect(backup.data.rules.find((rule) => rule.name === 'Veterinario')).toMatchObject({ enabled: false, actions: {} });
    expect(backup.data.budgetLimits.map((limit) => [limit.fromMonth, limit.amount]).sort()).toEqual([['2026-09', 30000], ['2026-10', 25000]]);
    expect(backup.data.goals.map((goal) => `${goal.name}:${goal.archived}:${goal.targetMonth}`).sort()).toEqual([
      'Coche:true:2026-09',
      'Colchón:false:null',
      'Viaje:false:2027-06',
    ]);
    expect(backup.data.importBatches.map((batch) => batch.undone).sort()).toEqual([false, true]);
    const bakery = backup.data.transactions.find((tx) => tx.bankConcept === 'Panaderia Pepe')!.id;
    expect(backup.data.reimbursements).toEqual([{ id: expect.any(String), incomeId: expect.any(String), expenseId: bakery, amount: 150 }]);
    expect(backup.data.savingsTargets.map((target) => [target.fromMonth, target.amount]).sort()).toEqual([['2026-09', 30000], ['2026-10', 20000]]);
  });

  it("keeps the data settings and leaves out the device's", async () => {
    const { repo, db } = await setup();
    await richData(repo, db);
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

  it('leaves out a link whose income or expense is gone or no longer one, so the copy always reads back', async () => {
    const { repo, db } = await setup();
    await richData(repo, db);
    const [link] = await db.reimbursements.toArray();
    const transfer = (await db.transactions.toArray()).find((tx) => tx.type === 'transfer')!.id;
    await db.reimbursements.bulkAdd([
      { ...link, id: 'gone', expenseId: 'no-such-transaction' },
      { ...link, id: 'transfer', expenseId: transfer },
    ]);

    const backup = await repo.exportBackup();
    expect(backup.data.reimbursements).toEqual([link]);
    expect(repo.readBackup(backupJson(backup)).ok).toBe(true);
  });

  it('writes plain JSON with 2-space indentation that reads back as the same backup', async () => {
    const { repo, db } = await setup();
    await richData(repo, db);
    const backup = await repo.exportBackup();

    const json = backupJson(backup);
    expect(json.startsWith('{\n  "app": "kuenta",\n  "format": 3,\n')).toBe(true);
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
    // A file that doesn't chain with the last one: the import account needs an adjustment.
    await records(() => importFile(repo, [{ valor: '15/10/2026', concepto: 'Gasolinera', movimiento: 'Pago con tarjeta', importe: -40 }], 500));
    await records(() => repo.createBalanceAdjustment());
    const mercadona = await transactionId(repo, 'Mercadona');
    await records(() => repo.updateTransaction(mercadona, { note: 'compra' }));

    // What an update leaves when its new starter rules would categorize what's already imported.
    await db.transactions.filter((tx) => tx.bankConcept === 'Gasolinera').modify({ categoryId: null });
    await db.settings.put({ key: 'starterRulesOffer', value: 'pending' });
    await records(async () => expect(await repo.acceptStarterRulesOffer()).toBe(1));

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

  it("doesn't count writes that change nothing", async () => {
    const { repo, clock, db } = await setup();
    await importFile(repo, october, 1000);
    const { id: accountId } = (await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string };
    const { id: goalId } = (await repo.createGoal({ name: 'Viaje', target: 100000, accountId, icon: 'plane', color: 'cyan' })) as { id: string };
    const ruleId = await repo.createRule({ name: 'Pan', match: { value: 'panaderia' }, actions: { payeeName: 'Panadería' } });
    const lastChangeAt = (await db.settings.get('lastChangeAt'))!.value;
    clock.now = new Date('2026-10-20T12:00:00');

    let notified = 0;
    repo.subscribe(() => notified++);
    const expenses = (await repo.listCategories()).filter((c) => c.kind === 'expense');
    const rules = await repo.listRules();
    // The first one can't go up, nor the last one down.
    await repo.moveCategory(expenses[0].id, 'up');
    await repo.moveCategory(expenses.at(-1)!.id, 'down');
    await repo.moveRule(rules[0].id, 'up');
    await repo.moveRule(rules.at(-1)!.id, 'down');
    // Saving an edit sheet as it opened.
    const tx = (await repo.getTransaction(await transactionId(repo, 'Mercadona')))!;
    await repo.updateTransaction(tx.id, { categoryId: tx.categoryId, payeeName: tx.payee?.name ?? '', note: tx.note });
    await repo.updateTransaction(tx.id, {});
    await repo.updateAccount(accountId, { name: 'Revolut', color: 'cyan' });
    await repo.setAccountArchived(accountId, false);
    await repo.updateCategory(expenses[0].id, { name: expenses[0].name });
    await repo.updateRule(ruleId, { name: 'Pan', match: { value: 'panaderia' } });
    const payee = (await repo.listPayees())[0];
    await repo.renamePayee(payee.id, payee.name);
    await repo.updateGoal(goalId, { name: 'Viaje', target: 100000, targetMonth: null });
    await repo.setGoalArchived(goalId, false);

    expect(notified).toBe(0);
    expect((await db.settings.get('lastChangeAt'))!.value).toBe(lastChangeAt);
    // Still as the rules left it: applying them later can change it.
    expect((await repo.getTransaction(tx.id))!.editedAt).toBeNull();
    expect((await repo.listCategories()).filter((c) => c.kind === 'expense').map((c) => c.id)).toEqual(expenses.map((c) => c.id));
    expect((await repo.listRules()).map((rule) => rule.id)).toEqual(rules.map((rule) => rule.id));

    // Archiving twice counts once.
    await repo.setAccountArchived(accountId, true);
    const archivedAt = (await db.settings.get('lastChangeAt'))!.value;
    clock.now = new Date('2026-10-20T13:00:00');
    await repo.setAccountArchived(accountId, true);
    expect((await db.settings.get('lastChangeAt'))!.value).toBe(archivedAt);
  });
});
