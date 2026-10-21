import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository, ImportPreview, TransactionView } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

async function setup() {
  const clock = { now: new Date('2026-10-20T10:00:00') };
  const repo = createDexieRepository({ name: `kuenta-transfer-rules-${++dbCount}`, now: () => clock.now });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  const { id: revolutId } = (await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string };
  const bbvaId = (await repo.listAccounts())[0].id;
  return { repo, clock, revolutId, bbvaId };
}

async function preview(repo: DataRepository, movements: SampleMovement[], startBalance = 1000): Promise<ImportPreview> {
  const result = await repo.previewImport(await bbvaXlsx(movements, { startBalance }), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return result.preview;
}

async function importFile(repo: DataRepository, movements: SampleMovement[], startBalance = 1000) {
  return repo.commitImport(await preview(repo, movements, startBalance));
}

async function categoryId(repo: DataRepository, name: string) {
  const category = (await repo.listCategories()).find((c) => c.name === name);
  if (!category) throw new Error(`No category ${name}`);
  return category.id;
}

async function transaction(repo: DataRepository, concept: string): Promise<TransactionView> {
  const tx = (await repo.listTransactions('2026-10')).find((t) => t.bankConcept === concept);
  if (!tx) throw new Error(`No transaction with concept ${concept}`);
  return tx;
}

function plannedRow(file: ImportPreview, concept: string) {
  const row = file.plan.rows.find((r) => r.concept === concept);
  if (!row) throw new Error(`No row with concept ${concept}`);
  return row;
}

async function balances(repo: DataRepository) {
  return Object.fromEntries((await repo.listAccounts()).map((account) => [account.name, account.balance]));
}

const transferRule = (accountId: string, payeeName?: string) => ({
  name: 'Revolut',
  match: { value: 'revolut' },
  actions: payeeName ? { transferAccountId: accountId, payeeName } : { transferAccountId: accountId },
});

const topUp: SampleMovement = { valor: '05/10/2026', concepto: 'Revolut**5625*', movimiento: 'Pago con tarjeta', importe: -200 };
const comeBack: SampleMovement = { valor: '08/10/2026', concepto: 'Revolut ltd', movimiento: 'Transferencia recibida', importe: 50 };
const groceries: SampleMovement = { valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -50 };

describe('transfer rules on import', () => {
  it('turn a charge into a transfer from the import account to the rule’s account, and the balance check still agrees', async () => {
    const { repo, revolutId, bbvaId } = await setup();
    await repo.createRule(transferRule(revolutId));

    const { check } = await importFile(repo, [groceries, topUp]);

    expect(await transaction(repo, 'Revolut**5625*')).toMatchObject({
      type: 'transfer',
      amount: 20000,
      accountId: bbvaId,
      toAccountId: revolutId,
      categoryId: null,
      editedAt: null,
    });
    expect(await balances(repo)).toEqual({ BBVA: 75000, Revolut: 20000 });
    expect(check.difference).toBe(0);
    expect((await repo.home('2026-10')).summary.expenses).toBe(5000);
  });

  it('turn a credit into a transfer from the rule’s account to the import account', async () => {
    const { repo, revolutId, bbvaId } = await setup();
    await repo.createRule(transferRule(revolutId));

    const { check } = await importFile(repo, [comeBack]);

    expect(await transaction(repo, 'Revolut ltd')).toMatchObject({
      type: 'transfer',
      amount: 5000,
      accountId: revolutId,
      toAccountId: bbvaId,
      categoryId: null,
    });
    expect(await balances(repo)).toEqual({ BBVA: 105000, Revolut: -5000 });
    expect(check.difference).toBe(0);
    expect((await repo.home('2026-10')).summary.income).toBe(0);
  });

  it('respect the rule’s direction, by the bank’s sign', async () => {
    const { repo, revolutId } = await setup();
    await repo.createRule({ ...transferRule(revolutId), match: { value: 'revolut', direction: 'out' } });

    await importFile(repo, [topUp, comeBack]);

    expect((await transaction(repo, 'Revolut**5625*')).type).toBe('transfer');
    expect((await transaction(repo, 'Revolut ltd')).type).toBe('income');
  });

  it('set the rule’s payee name too', async () => {
    const { repo, revolutId } = await setup();
    await repo.createRule(transferRule(revolutId, 'Recarga Revolut'));

    await importFile(repo, [topUp]);

    expect(await transaction(repo, 'Revolut**5625*')).toMatchObject({ type: 'transfer', payee: { name: 'Recarga Revolut' } });
  });

  it('compete with category rules by order: the first enabled match wins', async () => {
    const { repo, revolutId } = await setup();
    const transferId = await repo.createRule(transferRule(revolutId));
    // Created later, so it goes first and wins.
    const categoryRuleId = await repo.createRule({ name: 'Revolut ocio', match: { value: 'revolut' }, actions: { categoryId: await categoryId(repo, 'Ocio') } });

    let file = await preview(repo, [topUp]);
    expect(plannedRow(file, 'Revolut**5625*')).toMatchObject({ categoryId: await categoryId(repo, 'Ocio'), transferAccountId: null });

    await repo.updateRule(categoryRuleId, { enabled: false });
    file = await preview(repo, [topUp]);
    expect(plannedRow(file, 'Revolut**5625*')).toMatchObject({ categoryId: null, transferAccountId: revolutId });

    await repo.updateRule(categoryRuleId, { enabled: true });
    await repo.moveRule(transferId, 'up');
    await repo.commitImport(await preview(repo, [topUp]));
    expect(await transaction(repo, 'Revolut**5625*')).toMatchObject({ type: 'transfer', toAccountId: revolutId, categoryId: null });
  });

  it('keep working when their account is archived', async () => {
    const { repo, revolutId } = await setup();
    await repo.createRule(transferRule(revolutId));
    await repo.setAccountArchived(revolutId, true);

    await importFile(repo, [topUp]);

    expect(await transaction(repo, 'Revolut**5625*')).toMatchObject({ type: 'transfer', toAccountId: revolutId });
    expect((await balances(repo)).Revolut).toBe(20000);
  });

  it('are undone with the import, and the other account follows', async () => {
    const { repo, revolutId } = await setup();
    await repo.createRule(transferRule(revolutId));
    const { batch } = await importFile(repo, [topUp]);

    await repo.undoImport(batch.id);

    expect(await balances(repo)).toEqual({ BBVA: 0, Revolut: 0 });
  });
});

describe('saving a transfer rule', () => {
  it('keeps the transfer account, and a rule can switch between a category and a transfer account', async () => {
    const { repo, revolutId } = await setup();
    const id = await repo.createRule(transferRule(revolutId, 'Revolut'));
    expect((await repo.listRules()).find((rule) => rule.id === id)!.actions).toEqual({ transferAccountId: revolutId, payeeName: 'Revolut' });

    await repo.updateRule(id, { actions: { categoryId: await categoryId(repo, 'Ocio') } });
    expect((await repo.listRules()).find((rule) => rule.id === id)!.actions).toEqual({ categoryId: await categoryId(repo, 'Ocio') });

    await repo.updateRule(id, { actions: { transferAccountId: revolutId } });
    expect((await repo.listRules()).find((rule) => rule.id === id)!.actions).toEqual({ transferAccountId: revolutId });
  });

  it('refuses a rule with both a category and a transfer account, saving nothing', async () => {
    const { repo, revolutId } = await setup();
    const ocio = await categoryId(repo, 'Ocio');
    const id = await repo.createRule(transferRule(revolutId));
    const before = await repo.listRules();

    await expect(repo.createRule({ name: 'Ambas', match: { value: 'revolut' }, actions: { categoryId: ocio, transferAccountId: revolutId } })).rejects.toThrow();
    await expect(repo.updateRule(id, { actions: { categoryId: ocio, transferAccountId: revolutId } })).rejects.toThrow();
    const mercadona = before.find((rule) => rule.name === 'Mercadona')!;
    await expect(repo.updateRule(mercadona.id, { actions: { ...mercadona.actions, transferAccountId: revolutId } })).rejects.toThrow();

    expect(await repo.listRules()).toEqual(before);
  });

  it('refuses the import account or an unknown account as the transfer account', async () => {
    const { repo, bbvaId } = await setup();
    const before = await repo.listRules();

    await expect(repo.createRule({ name: 'BBVA', match: { value: 'bbva' }, actions: { transferAccountId: bbvaId } })).rejects.toThrow();
    await expect(repo.createRule({ name: 'Nada', match: { value: 'nada' }, actions: { transferAccountId: 'nope' } })).rejects.toThrow();

    expect(await repo.listRules()).toEqual(before);
  });
});

describe('transfer rules in the import preview', () => {
  it('give the row the transfer account and no category', async () => {
    const { repo, revolutId } = await setup();
    await repo.createRule(transferRule(revolutId, 'Revolut'));

    const file = await preview(repo, [groceries, topUp]);

    expect(plannedRow(file, 'Revolut**5625*')).toMatchObject({ transferAccountId: revolutId, categoryId: null, payeeName: 'Revolut' });
    expect(plannedRow(file, 'Mercadona')).toMatchObject({ transferAccountId: null, categoryId: await categoryId(repo, 'Supermercado') });
  });

  it('give way to a category chosen in the row: an ordinary expense with that category, edited by the user', async () => {
    const { repo, clock, revolutId, bbvaId } = await setup();
    await repo.createRule(transferRule(revolutId));
    const file = await preview(repo, [topUp, comeBack]);
    const ocio = await categoryId(repo, 'Ocio');

    clock.now = new Date('2026-10-21T09:00:00');
    await repo.commitImport(file, {
      categories: { [plannedRow(file, 'Revolut**5625*').hash]: ocio, [plannedRow(file, 'Revolut ltd').hash]: null },
    });

    expect(await transaction(repo, 'Revolut**5625*')).toMatchObject({
      type: 'expense',
      accountId: bbvaId,
      toAccountId: null,
      categoryId: ocio,
      editedAt: clock.now.toISOString(),
    });
    // "Sin categoría" chosen in the row overrides the rule as well.
    expect(await transaction(repo, 'Revolut ltd')).toMatchObject({ type: 'income', toAccountId: null, categoryId: null });
    expect((await transaction(repo, 'Revolut ltd')).editedAt).not.toBeNull();
    expect((await balances(repo)).Revolut).toBe(0);
  });

  it('created from a row are applied to the remaining new rows when the preview is re-planned', async () => {
    const { repo, revolutId } = await setup();
    const file = await preview(repo, [groceries, topUp, comeBack]);
    expect(plannedRow(file, 'Revolut**5625*').transferAccountId).toBeNull();

    await repo.createRule(transferRule(revolutId));
    const replanned = await repo.replanImport(file);

    expect(plannedRow(replanned, 'Revolut**5625*')).toMatchObject({ transferAccountId: revolutId, categoryId: null });
    expect(plannedRow(replanned, 'Revolut ltd')).toMatchObject({ transferAccountId: revolutId, categoryId: null });
    expect(plannedRow(replanned, 'Mercadona').transferAccountId).toBeNull();

    await repo.commitImport(replanned);
    expect(await balances(repo)).toEqual({ BBVA: 80000, Revolut: 15000 });
    expect((await repo.balanceCheck())?.difference).toBe(0);
  });
});

describe('transfer rules and rules applied to transactions already imported', () => {
  it('count matches and never give a category when a transfer rule wins', async () => {
    const { repo, revolutId } = await setup();
    await importFile(repo, [topUp]);
    await repo.createRule({ name: 'Revolut ocio', match: { value: 'revolut' }, actions: { categoryId: await categoryId(repo, 'Ocio') } });
    await repo.createRule(transferRule(revolutId));

    expect((await repo.previewRule({ match: { value: 'revolut' }, actions: { transferAccountId: revolutId } })).matching).toBe(1);
    await repo.applyRules();

    expect((await transaction(repo, 'Revolut**5625*')).categoryId).toBeNull();
  });
});
