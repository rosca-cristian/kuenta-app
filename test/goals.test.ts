import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import { KuentaDb } from '../src/data/dexie/db';
import type { DataRepository, GoalDraft } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

/** The clock reads Tuesday 20 October 2026, as in the other repository tests. */
async function setup() {
  const name = `kuenta-goals-test-${++dbCount}`;
  const repo = createDexieRepository({ name, now: () => new Date('2026-10-20T10:00:00') });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  const revolut = await repo.createAccount({ name: 'Revolut', type: 'savings', icon: 'piggy-bank', color: 'cyan' });
  if (!revolut.ok) throw new Error('Revolut not created');
  const bbvaId = (await repo.getSettings()).importAccountId!;
  return { repo, name, bbvaId, revolutId: revolut.id };
}

async function importFile(repo: DataRepository, movements: SampleMovement[], startBalance = 1000) {
  const result = await repo.previewImport(await bbvaXlsx(movements, { startBalance }), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return repo.commitImport(result.preview);
}

async function transactionId(repo: DataRepository, concept: string) {
  const tx = (await repo.listTransactions('2026-10')).find((t) => t.bankConcept === concept);
  if (!tx) throw new Error(`No transaction ${concept}`);
  return tx.id;
}

async function createGoal(repo: DataRepository, draft: GoalDraft) {
  const result = await repo.createGoal(draft);
  if (!result.ok) throw new Error(`Goal not created: ${result.reason}`);
  return result.id;
}

const goalNamed = async (repo: DataRepository, name: string) => (await repo.listGoals()).find((goal) => goal.name === name);

const japan = (accountId: string): GoalDraft => ({ name: 'Viaje Japón', target: 300000, accountId, icon: 'plane', color: 'red' });

const october: SampleMovement[] = [
  { valor: '01/10/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
  { valor: '05/10/2026', concepto: 'Revolut**5625*', movimiento: 'Pago con tarjeta', importe: -200 },
  { valor: '06/10/2026', concepto: 'Revolut**5626*', movimiento: 'Pago con tarjeta', importe: -400 },
];

describe('creating a goal', () => {
  it('stores it without a target month and lists it with its account and progress', async () => {
    const { repo, revolutId } = await setup();
    expect(await repo.listGoals()).toEqual([]);

    const id = await createGoal(repo, { ...japan(revolutId), name: '  Viaje   Japón ' });

    expect(await repo.listGoals()).toEqual([
      {
        id,
        name: 'Viaje Japón',
        target: 300000,
        targetMonth: null,
        accountId: revolutId,
        icon: 'plane',
        color: 'red',
        archived: false,
        account: expect.objectContaining({ id: revolutId, name: 'Revolut' }),
        current: 0,
        percent: 0,
        reached: false,
        plan: null,
      },
    ]);
  });

  it('stores a target month, any month past ones included, and throws for one that is not a month', async () => {
    const { repo, bbvaId, revolutId } = await setup();

    await createGoal(repo, { ...japan(revolutId), targetMonth: '2027-06' });
    await createGoal(repo, { name: 'Colchón', target: 100000, targetMonth: '2025-01', accountId: bbvaId, icon: 'landmark', color: 'blue' });

    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ targetMonth: '2027-06' });
    expect(await goalNamed(repo, 'Colchón')).toMatchObject({ targetMonth: '2025-01' });
    const { id: huchaId } = (await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'pink' })) as { id: string };
    for (const targetMonth of ['2027-13', '2027-6', '2027-06-01', '']) {
      await expect(repo.createGoal({ ...japan(huchaId), targetMonth })).rejects.toThrow();
    }
    expect(await repo.listGoals()).toHaveLength(2);
  });

  it('refuses an empty name, and throws for a target that is not above 0 or an unknown account', async () => {
    const { repo, revolutId } = await setup();
    expect(await repo.createGoal({ ...japan(revolutId), name: '   ' })).toEqual({ ok: false, reason: 'empty' });
    await expect(repo.createGoal({ ...japan(revolutId), target: 0 })).rejects.toThrow();
    await expect(repo.createGoal({ ...japan(revolutId), target: -100 })).rejects.toThrow();
    await expect(repo.createGoal({ ...japan(revolutId), target: 10.5 })).rejects.toThrow();
    await expect(repo.createGoal(japan('nope'))).rejects.toThrow();
    expect(await repo.listGoals()).toEqual([]);
  });

  it('can be linked to the import account, whose balance comes from the imports', async () => {
    const { repo, bbvaId } = await setup();
    await importFile(repo, october);

    await createGoal(repo, { name: 'Colchón', target: 200000, accountId: bbvaId, icon: 'landmark', color: 'blue' });

    expect(await goalNamed(repo, 'Colchón')).toMatchObject({ accountId: bbvaId, current: 190000, percent: 95, reached: false });
  });

  it('refuses a second goal on an account that already has one, and offers only the accounts without one', async () => {
    const { repo, bbvaId, revolutId } = await setup();
    const { id: emptyId } = (await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'pink' })) as { id: string };
    expect((await repo.goalAccounts()).map((account) => account.name)).toEqual(['BBVA', 'Revolut', 'Hucha']);
    const japanId = await createGoal(repo, japan(revolutId));

    const second = await repo.createGoal({ ...japan(revolutId), name: 'Coche' });

    expect(second).toEqual({ ok: false, reason: 'taken', existing: expect.objectContaining({ id: japanId, name: 'Viaje Japón' }) });
    expect((await repo.listGoals()).map((goal) => goal.name)).toEqual(['Viaje Japón']);
    expect((await repo.goalAccounts()).map((account) => account.id)).toEqual([bbvaId, emptyId]);
  });

  it("doesn't offer archived accounts, and refuses a goal on one", async () => {
    const { repo, revolutId } = await setup();
    await repo.setAccountArchived(revolutId, true);

    expect((await repo.goalAccounts()).map((account) => account.name)).toEqual(['BBVA']);
    await expect(repo.createGoal(japan(revolutId))).rejects.toThrow();
  });
});

describe("a goal's progress", () => {
  it("follows its account's balance, and a transfer into the non-imported account raises it", async () => {
    const { repo, revolutId } = await setup();
    await importFile(repo, october);
    await createGoal(repo, japan(revolutId));
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ current: 0, percent: 0, reached: false });

    await repo.updateTransaction(await transactionId(repo, 'Revolut**5625*'), { transferAccountId: revolutId });
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ current: 20000, reached: false });
    expect((await goalNamed(repo, 'Viaje Japón'))!.percent).toBeCloseTo(6.667, 3);

    await repo.updateTransaction(await transactionId(repo, 'Revolut**5626*'), { transferAccountId: revolutId });
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ current: 60000, percent: 20 });

    // Typing the balance by hand (an adjustment) moves it too, as does the opening balance.
    await repo.updateAccountBalance(revolutId, 90000);
    await repo.updateAccount(revolutId, { openingBalance: 15000 });
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ current: 105000, percent: 35 });
  });

  it('shows 0 % while the balance is negative, with the balance itself as current', async () => {
    const { repo, revolutId } = await setup();
    await repo.updateAccount(revolutId, { openingBalance: -5000 });
    await createGoal(repo, japan(revolutId));

    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ current: -5000, percent: 0, reached: false });
  });

  it('is reached at the target and above it, and the goal stays listed', async () => {
    const { repo, revolutId } = await setup();
    await createGoal(repo, japan(revolutId));

    await repo.updateAccountBalance(revolutId, 300000);
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ current: 300000, percent: 100, reached: true });
    await repo.updateAccountBalance(revolutId, 299999);
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ reached: false });
    await repo.updateAccountBalance(revolutId, 450000);
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ current: 450000, percent: 150, reached: true, archived: false });
  });

  it('keeps showing the balance of an archived account', async () => {
    const { repo, revolutId } = await setup();
    await repo.updateAccountBalance(revolutId, 120000);
    await createGoal(repo, japan(revolutId));

    await repo.setAccountArchived(revolutId, true);

    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({
      account: expect.objectContaining({ id: revolutId, archived: true }),
      current: 120000,
      percent: 40,
    });
  });
});

describe('listing goals', () => {
  it("lists them in their accounts' order, archived goals included, with an archived goal not blocking its account", async () => {
    const { repo, bbvaId, revolutId } = await setup();
    await createGoal(repo, japan(revolutId));
    await createGoal(repo, { name: 'Colchón', target: 100000, accountId: bbvaId, icon: 'landmark', color: 'blue' });
    await repo.setGoalArchived((await goalNamed(repo, 'Viaje Japón'))!.id, true);

    expect((await repo.goalAccounts()).map((account) => account.name)).toEqual(['Revolut']);
    await createGoal(repo, { ...japan(revolutId), name: 'Coche' });

    expect((await repo.listGoals()).map((goal) => [goal.name, goal.archived])).toEqual([
      ['Colchón', false],
      ['Coche', false],
      ['Viaje Japón', true],
    ]);
  });

  it('leaves out a goal whose account is gone, as one left behind before account deletion took goals along', async () => {
    const { repo, name, revolutId } = await setup();
    await createGoal(repo, japan(revolutId));
    await new KuentaDb(name).goals.add({ ...japan('gone'), id: 'orphan', targetMonth: null, archived: false });

    expect((await repo.listGoals()).map((goal) => goal.name)).toEqual(['Viaje Japón']);
  });
});

describe('a target month', () => {
  it('asks to save what is missing over the months left, from the current month to the target one', async () => {
    const { repo, revolutId } = await setup();
    await repo.updateAccountBalance(revolutId, 60000);
    const id = await createGoal(repo, { ...japan(revolutId), targetMonth: '2027-06' });

    // October 2026 → June 2027: November to June, 8 months.
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ reached: false, plan: { kind: 'save', monthsLeft: 8, perMonth: 30000 } });

    await repo.updateGoal(id, { targetMonth: '2026-11' });
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ plan: { kind: 'save', monthsLeft: 1, perMonth: 240000 } });
    // The current month still has itself left.
    await repo.updateGoal(id, { targetMonth: '2026-10' });
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ plan: { kind: 'save', monthsLeft: 1, perMonth: 240000 } });

    // Money moved into the account lowers it.
    await repo.updateGoal(id, { targetMonth: '2027-06' });
    await repo.updateAccountBalance(revolutId, 140000);
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ plan: { kind: 'save', monthsLeft: 8, perMonth: 20000 } });
  });

  it('rounds the monthly amount up to the cent, and counts an overdrawn balance as missing too', async () => {
    const { repo, revolutId } = await setup();
    const id = await createGoal(repo, { ...japan(revolutId), target: 100000, targetMonth: '2027-05' });

    // 1.000 € over 7 months is 142,857… €: 142,86 €.
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ plan: { kind: 'save', monthsLeft: 7, perMonth: 14286 } });
    await repo.updateGoal(id, { targetMonth: '2027-01' });
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ plan: { kind: 'save', monthsLeft: 3, perMonth: 33334 } });

    await repo.updateAccount(revolutId, { openingBalance: -5000 });
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ percent: 0, plan: { kind: 'save', monthsLeft: 3, perMonth: 35000 } });
  });

  it('says the date passed, with what is missing, once the target month is before the current one', async () => {
    const { repo, revolutId } = await setup();
    await repo.updateAccountBalance(revolutId, 60000);
    await createGoal(repo, { ...japan(revolutId), targetMonth: '2026-09' });

    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ reached: false, plan: { kind: 'overdue', missing: 240000 } });
  });

  it('gives no monthly amount without a target month, nor once the goal is reached', async () => {
    const { repo, bbvaId, revolutId } = await setup();
    await createGoal(repo, japan(revolutId));
    const colchonId = await createGoal(repo, { name: 'Colchón', target: 100000, targetMonth: '2027-06', accountId: bbvaId, icon: 'landmark', color: 'blue' });
    await importFile(repo, october);
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ plan: null });
    expect(await goalNamed(repo, 'Colchón')).toMatchObject({ current: 190000, reached: true, plan: null });

    // Reached past its target month: *Conseguido*, not "Fecha superada".
    await repo.updateGoal(colchonId, { targetMonth: '2026-01' });
    expect(await goalNamed(repo, 'Colchón')).toMatchObject({ reached: true, plan: null });
  });
});

describe('editing a goal', () => {
  it('changes every field, the account included, and only the ones given', async () => {
    const { repo, bbvaId, revolutId } = await setup();
    const { id: huchaId } = (await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'pink' })) as { id: string };
    const id = await createGoal(repo, { ...japan(revolutId), targetMonth: '2027-06' });

    const result = await repo.updateGoal(id, { name: '  Japón   2027 ', target: 400000, targetMonth: null, accountId: huchaId, icon: 'gift', color: 'cyan' });

    expect(result).toEqual({ ok: true, id });
    const edited = { id, name: 'Japón 2027', target: 400000, targetMonth: null, accountId: huchaId, icon: 'gift', color: 'cyan', archived: false };
    expect(await goalNamed(repo, 'Japón 2027')).toMatchObject({ ...edited, account: expect.objectContaining({ name: 'Hucha' }) });
    // Revolut is free again.
    expect((await repo.goalAccounts()).map((account) => account.id)).toEqual([bbvaId, revolutId]);

    await repo.updateGoal(id, { targetMonth: '2026-12' });
    expect(await goalNamed(repo, 'Japón 2027')).toMatchObject({ ...edited, targetMonth: '2026-12' });
  });

  it('refuses an empty name or an account with another active goal, and throws for a bad target, month, account or goal', async () => {
    const { repo, bbvaId, revolutId } = await setup();
    const { id: huchaId } = (await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'pink' })) as { id: string };
    await repo.setAccountArchived(huchaId, true);
    const id = await createGoal(repo, japan(revolutId));
    const colchonId = await createGoal(repo, { name: 'Colchón', target: 100000, accountId: bbvaId, icon: 'landmark', color: 'blue' });
    const before = await repo.listGoals();

    expect(await repo.updateGoal(id, { name: '  ' })).toEqual({ ok: false, reason: 'empty' });
    expect(await repo.updateGoal(id, { name: 'Coche', accountId: bbvaId })).toEqual({
      ok: false,
      reason: 'taken',
      existing: expect.objectContaining({ id: colchonId, name: 'Colchón' }),
    });
    await expect(repo.updateGoal(id, { target: 0 })).rejects.toThrow();
    await expect(repo.updateGoal(id, { target: 99.5 })).rejects.toThrow();
    await expect(repo.updateGoal(id, { targetMonth: '2027-13' })).rejects.toThrow();
    await expect(repo.updateGoal(id, { accountId: 'nope' })).rejects.toThrow();
    await expect(repo.updateGoal(id, { accountId: huchaId })).rejects.toThrow();
    await expect(repo.updateGoal('missing', { name: 'Coche' })).rejects.toThrow();

    expect(await repo.listGoals()).toEqual(before);
  });

  it("keeps the goal's own account, even an archived one, and offers it in the goal's picker", async () => {
    const { repo, bbvaId, revolutId } = await setup();
    const { id: huchaId } = (await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'pink' })) as { id: string };
    const id = await createGoal(repo, japan(revolutId));
    const colchonId = await createGoal(repo, { name: 'Colchón', target: 100000, accountId: bbvaId, icon: 'landmark', color: 'blue' });
    await repo.setAccountArchived(revolutId, true);

    expect((await repo.goalAccounts()).map((account) => account.name)).toEqual(['Hucha']);
    expect((await repo.goalAccounts(id)).map((account) => account.name)).toEqual(['Revolut', 'Hucha']);
    expect((await repo.goalAccounts(colchonId)).map((account) => account.name)).toEqual(['BBVA', 'Hucha']);

    expect(await repo.updateGoal(id, { name: 'Japón', accountId: revolutId })).toEqual({ ok: true, id });
    expect(await goalNamed(repo, 'Japón')).toMatchObject({ accountId: revolutId });
    expect(await repo.updateGoal(id, { accountId: huchaId })).toEqual({ ok: true, id });
    // Once moved off it, the archived account is no longer offered.
    expect((await repo.goalAccounts(id)).map((account) => account.name)).toEqual(['Hucha']);
  });
});

describe('goals on Inicio', () => {
  it('shows the non-archived goals with their progress, in the goals list order', async () => {
    const { repo, bbvaId, revolutId } = await setup();
    await importFile(repo, october);
    expect((await repo.home('2026-10')).goals).toEqual([]);

    await createGoal(repo, { name: 'Colchón', target: 100000, accountId: bbvaId, icon: 'landmark', color: 'blue' });
    const japanId = await createGoal(repo, japan(revolutId));
    await repo.setGoalArchived(japanId, true);
    await createGoal(repo, { ...japan(revolutId), name: 'Coche', target: 50000 });

    const goals = (await repo.home('2026-10')).goals;
    expect(goals.map((goal) => [goal.name, goal.current, goal.percent, goal.reached])).toEqual([
      ['Colchón', 190000, 190, true],
      ['Coche', 0, 0, false],
    ]);
    expect(goals).toEqual((await repo.listGoals()).filter((goal) => !goal.archived));
    // Whatever month Inicio shows: a goal's progress is its account's balance today.
    expect((await repo.home('2026-08')).goals).toEqual(goals);
  });
});

describe('archiving a goal', () => {
  it('frees its account for a new goal, and unarchiving it is refused while that account has another active goal', async () => {
    const { repo, bbvaId, revolutId } = await setup();
    const japanId = await createGoal(repo, japan(revolutId));

    expect(await repo.setGoalArchived(japanId, true)).toEqual({ ok: true, id: japanId });
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ archived: true });
    expect((await repo.goalAccounts()).map((account) => account.id)).toEqual([bbvaId, revolutId]);
    const cocheId = await createGoal(repo, { ...japan(revolutId), name: 'Coche' });

    expect(await repo.setGoalArchived(japanId, false)).toEqual({
      ok: false,
      reason: 'taken',
      existing: expect.objectContaining({ id: cocheId, name: 'Coche' }),
    });
    expect(await goalNamed(repo, 'Viaje Japón')).toMatchObject({ archived: true });

    await repo.setGoalArchived(cocheId, true);
    expect(await repo.setGoalArchived(japanId, false)).toEqual({ ok: true, id: japanId });
    expect((await repo.listGoals()).map((goal) => [goal.name, goal.archived])).toEqual([
      ['Viaje Japón', false],
      ['Coche', true],
    ]);
  });

  it('lets an archived goal move to an account with an active goal, which then blocks unarchiving it', async () => {
    const { repo, bbvaId, revolutId } = await setup();
    const japanId = await createGoal(repo, japan(revolutId));
    await createGoal(repo, { name: 'Colchón', target: 100000, accountId: bbvaId, icon: 'landmark', color: 'blue' });
    await repo.setGoalArchived(japanId, true);

    // Archived, it counts nothing twice.
    expect(await repo.updateGoal(japanId, { accountId: bbvaId })).toEqual({ ok: true, id: japanId });
    expect(await repo.setGoalArchived(japanId, false)).toMatchObject({ ok: false, reason: 'taken' });
  });

  it('throws for an unknown goal', async () => {
    const { repo } = await setup();
    await expect(repo.setGoalArchived('missing', true)).rejects.toThrow();
  });
});

describe('deleting a goal', () => {
  it('deletes only the goal', async () => {
    const { repo, bbvaId, revolutId } = await setup();
    await importFile(repo, october);
    await repo.updateTransaction(await transactionId(repo, 'Revolut**5625*'), { transferAccountId: revolutId });
    const japanId = await createGoal(repo, japan(revolutId));
    await createGoal(repo, { name: 'Colchón', target: 100000, accountId: bbvaId, icon: 'landmark', color: 'blue' });
    const accounts = await repo.listAccounts();
    const transactions = await repo.listTransactions('2026-10');

    await repo.deleteGoal(japanId);

    expect((await repo.listGoals()).map((goal) => goal.name)).toEqual(['Colchón']);
    expect(await repo.listAccounts()).toEqual(accounts);
    expect(await repo.listTransactions('2026-10')).toEqual(transactions);
    expect((await repo.goalAccounts()).map((account) => account.id)).toEqual([revolutId]);
    await expect(repo.deleteGoal(japanId)).rejects.toThrow();
  });
});

describe('deleting an account', () => {
  it('deletes its goals, archived ones too, along with disabling the rules that transfer to it', async () => {
    const { repo, bbvaId, revolutId } = await setup();
    const japanId = await createGoal(repo, japan(revolutId));
    await repo.setGoalArchived(japanId, true);
    await createGoal(repo, { ...japan(revolutId), name: 'Coche' });
    await createGoal(repo, { name: 'Colchón', target: 100000, accountId: bbvaId, icon: 'landmark', color: 'blue' });
    await repo.createRule({ name: 'Revolut', match: { value: 'revolut' }, actions: { transferAccountId: revolutId } });

    await repo.deleteAccount(revolutId);

    expect((await repo.listGoals()).map((goal) => goal.name)).toEqual(['Colchón']);
    const rule = (await repo.listRules()).find((r) => r.name === 'Revolut')!;
    expect(rule.enabled).toBe(false);
    expect(rule.actions.transferAccountId).toBeUndefined();
  });

  it('keeps them when the deletion is refused', async () => {
    const { repo, revolutId } = await setup();
    await repo.updateAccountBalance(revolutId, 5000);
    await createGoal(repo, japan(revolutId));

    await expect(repo.deleteAccount(revolutId)).rejects.toThrow();

    expect((await repo.listGoals()).map((goal) => goal.name)).toEqual(['Viaje Japón']);
  });
});
