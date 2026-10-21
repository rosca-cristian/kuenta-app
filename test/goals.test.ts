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
      },
    ]);
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
    const { repo, name, bbvaId, revolutId } = await setup();
    await createGoal(repo, japan(revolutId));
    await createGoal(repo, { name: 'Colchón', target: 100000, accountId: bbvaId, icon: 'landmark', color: 'blue' });
    // Archiving comes with a later ticket; until then the stored flag is what counts.
    const japanGoal = (await goalNamed(repo, 'Viaje Japón'))!;
    await new KuentaDb(name).goals.update(japanGoal.id, { archived: true });

    expect((await repo.goalAccounts()).map((account) => account.name)).toEqual(['Revolut']);
    await createGoal(repo, { ...japan(revolutId), name: 'Coche' });

    expect((await repo.listGoals()).map((goal) => [goal.name, goal.archived])).toEqual([
      ['Colchón', false],
      ['Coche', false],
      ['Viaje Japón', true],
    ]);
  });

  it('leaves out a goal whose account is gone', async () => {
    const { repo, revolutId } = await setup();
    await createGoal(repo, japan(revolutId));

    await repo.deleteAccount(revolutId);

    expect(await repo.listGoals()).toEqual([]);
  });
});
