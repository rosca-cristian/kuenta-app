import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository, TransactionView } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

const september: SampleMovement[] = [
  { valor: '01/09/2026', concepto: 'Abono de nómina', movimiento: 'Transferencia recibida', importe: 1500 },
  { valor: '05/09/2026', concepto: 'Revolut**5625*', movimiento: 'Pago con tarjeta', importe: -200 },
  { valor: '10/09/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -50 },
  { valor: '20/09/2026', concepto: 'Revolut**5625*', movimiento: 'Pago con tarjeta', importe: -100 },
];
const october: SampleMovement[] = [
  { valor: '05/10/2026', concepto: 'Revolut**5625*', movimiento: 'Pago con tarjeta', importe: -200 },
  { valor: '08/10/2026', concepto: 'Revolut ltd', movimiento: 'Transferencia recibida', importe: 50 },
  { valor: '12/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -30 },
  { valor: '15/10/2026', concepto: 'Revolut**5625*', movimiento: 'Pago con tarjeta', importe: -150 },
];

async function importFile(repo: DataRepository, movements: SampleMovement[], startBalance: number) {
  const result = await repo.previewImport(await bbvaXlsx(movements, { startBalance }), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return repo.commitImport(result.preview);
}

/**
 * September and October imported, with no rule about Revolut yet, and Revolut and Hucha
 * created with no balance. The 15/10 Revolut charge was categorized by hand.
 */
async function setup() {
  const clock = { now: new Date('2026-10-20T10:00:00') };
  const repo = createDexieRepository({ name: `kuenta-apply-transfers-${++dbCount}`, now: () => clock.now });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  await importFile(repo, september, 1000);
  await importFile(repo, october, 2150);
  const { id: revolutId } = (await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string };
  const { id: huchaId } = (await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'pink' })) as { id: string };
  const bbvaId = (await repo.listAccounts())[0].id;
  const ocio = await categoryId(repo, 'Ocio');
  await repo.updateTransaction((await transaction(repo, '15/10')).id, { categoryId: ocio });
  return { repo, clock, revolutId, huchaId, bbvaId, ocio };
}

async function categoryId(repo: DataRepository, name: string) {
  const category = (await repo.listCategories()).find((c) => c.name === name);
  if (!category) throw new Error(`No category ${name}`);
  return category.id;
}

/** The transaction with this value date ("dd/mm"). */
async function transaction(repo: DataRepository, day: string): Promise<TransactionView> {
  const [dd, mm] = day.split('/');
  const tx = (await repo.listTransactions(`2026-${mm}`)).find((t) => t.date === `2026-${mm}-${dd}`);
  if (!tx) throw new Error(`No transaction on ${day}`);
  return tx;
}

async function balances(repo: DataRepository) {
  return Object.fromEntries((await repo.listAccounts()).map((account) => [account.name, account.balance]));
}

const transferRule = (accountId: string, match: { value: string; direction?: 'any' | 'out' | 'in' } = { value: 'revolut' }) => ({
  name: 'Revolut',
  match,
  actions: { transferAccountId: accountId },
});

describe('applying a transfer rule to transactions already imported', () => {
  it('offers the never-edited matching transactions, converts them by the bank’s sign and says how many changed', async () => {
    const { repo, revolutId, bbvaId, ocio } = await setup();
    const ruleId = await repo.createRule(transferRule(revolutId));

    // The edited 15/10 charge matches but isn't offered.
    expect(await repo.previewRule({ match: { value: 'revolut' }, actions: { transferAccountId: revolutId } })).toEqual({
      matching: 5,
      applicable: 4,
    });
    expect(await repo.applyRules(ruleId)).toBe(4);

    for (const day of ['05/09', '20/09', '05/10']) {
      expect(await transaction(repo, day)).toMatchObject({
        type: 'transfer',
        accountId: bbvaId,
        toAccountId: revolutId,
        categoryId: null,
        editedAt: null,
      });
    }
    expect(await transaction(repo, '08/10')).toMatchObject({
      type: 'transfer',
      amount: 5000,
      accountId: revolutId,
      toAccountId: bbvaId,
      categoryId: null,
      editedAt: null,
    });
    expect(await transaction(repo, '15/10')).toMatchObject({ type: 'expense', toAccountId: null, categoryId: ocio });
    // Applying again changes nothing.
    expect(await repo.previewRule({ match: { value: 'revolut' }, actions: { transferAccountId: revolutId } })).toEqual({
      matching: 5,
      applicable: 0,
    });
    expect(await repo.applyRules(ruleId)).toBe(0);
  });

  it('moves the money to Revolut, out of the month’s expenses, and the balance check still agrees', async () => {
    const { repo, revolutId } = await setup();
    const before = await balances(repo);
    expect((await repo.home('2026-10')).summary).toMatchObject({ expenses: 38000, income: 5000 });
    const ruleId = await repo.createRule(transferRule(revolutId));

    await repo.applyRules(ruleId);

    expect(await balances(repo)).toEqual({ BBVA: before.BBVA, Revolut: 45000, Hucha: 0 });
    expect((await repo.home('2026-10')).summary).toMatchObject({ expenses: 18000, income: 0 });
    expect((await repo.home('2026-09')).summary).toMatchObject({ expenses: 5000, income: 150000 });
    // The money that looked spent is now in Revolut.
    expect((await repo.home('2026-10')).totalBalance).toBe(before.BBVA + 45000);
    expect((await repo.balanceCheck())?.difference).toBe(0);
  });

  it('is part of applying every rule, and moves a rule-made transfer to the account of the rule that now wins', async () => {
    const { repo, revolutId, huchaId, bbvaId } = await setup();
    await repo.createRule(transferRule(revolutId));
    expect(await repo.applyRules()).toBe(4);

    // Created later, so it goes first and wins.
    await repo.createRule({ ...transferRule(huchaId), match: { value: 'revolut**' } });
    expect(await repo.applyRules()).toBe(3);

    expect(await transaction(repo, '05/09')).toMatchObject({ type: 'transfer', accountId: bbvaId, toAccountId: huchaId, editedAt: null });
    expect(await transaction(repo, '08/10')).toMatchObject({ type: 'transfer', accountId: revolutId, toAccountId: bbvaId });
    expect(await balances(repo)).toMatchObject({ Revolut: -5000, Hucha: 50000 });
    expect((await repo.balanceCheck())?.difference).toBe(0);
  });
});

describe('a category rule on transfers a rule made', () => {
  it('turns them back into expenses or incomes, by the bank’s sign, with its category', async () => {
    const { repo, revolutId, bbvaId, ocio } = await setup();
    const transferId = await repo.createRule(transferRule(revolutId));
    await repo.applyRules(transferId);

    await repo.updateRule(transferId, { enabled: false });
    const draft = { match: { value: 'revolut' }, actions: { categoryId: ocio } };
    expect(await repo.previewRule(draft)).toEqual({ matching: 5, applicable: 4 });
    await repo.createRule({ name: 'Revolut ocio', ...draft });
    expect(await repo.applyRules()).toBe(4);

    for (const day of ['05/09', '20/09', '05/10']) {
      expect(await transaction(repo, day)).toMatchObject({ type: 'expense', accountId: bbvaId, toAccountId: null, categoryId: ocio, editedAt: null });
    }
    expect(await transaction(repo, '08/10')).toMatchObject({ type: 'income', accountId: bbvaId, toAccountId: null, categoryId: ocio });
    expect((await balances(repo)).Revolut).toBe(0);
    expect((await repo.home('2026-10')).summary).toMatchObject({ expenses: 38000, income: 5000 });
    expect((await repo.balanceCheck())?.difference).toBe(0);
  });

  it('only counts and reverts what it matches, by the bank’s sign on the import account', async () => {
    const { repo, revolutId, bbvaId } = await setup();
    const transferId = await repo.createRule(transferRule(revolutId));
    await repo.applyRules(transferId);
    await repo.updateRule(transferId, { enabled: false });
    const otrosIngresos = await categoryId(repo, 'Otros ingresos');

    // The credit came back from Revolut: a credit for BBVA, though Revolut is the account the money leaves.
    const incoming = { match: { value: 'revolut', direction: 'in' as const }, actions: { categoryId: otrosIngresos } };
    expect(await repo.previewRule(incoming)).toEqual({ matching: 1, applicable: 1 });
    const ruleId = await repo.createRule({ name: 'Vuelta de Revolut', ...incoming });
    expect(await repo.applyRules(ruleId)).toBe(1);

    expect(await transaction(repo, '08/10')).toMatchObject({ type: 'income', accountId: bbvaId, toAccountId: null, categoryId: otrosIngresos });
    expect((await transaction(repo, '05/10')).type).toBe('transfer');
  });
});

describe('transfer rules matched by direction', () => {
  it('use the bank’s sign, so an incoming transfer is a credit and an outgoing one a charge', async () => {
    const { repo, revolutId, bbvaId } = await setup();
    const inId = await repo.createRule({ ...transferRule(revolutId, { value: 'revolut', direction: 'in' }), name: 'Vuelta' });

    expect(await repo.applyRules(inId)).toBe(1);
    expect(await transaction(repo, '08/10')).toMatchObject({ type: 'transfer', accountId: revolutId, toAccountId: bbvaId });
    expect((await transaction(repo, '05/10')).type).toBe('expense');

    // Already an incoming transfer: an "in" rule still matches it, an "out" rule doesn't.
    const inDraft = { match: { value: 'revolut ltd', direction: 'in' as const }, actions: { transferAccountId: revolutId } };
    expect(await repo.previewRule(inDraft)).toEqual({ matching: 1, applicable: 0 });
    const outDraft = { match: { value: 'revolut ltd', direction: 'out' as const }, actions: { transferAccountId: revolutId } };
    expect(await repo.previewRule(outDraft)).toEqual({ matching: 0, applicable: 0 });

    const outId = await repo.createRule({ ...transferRule(revolutId, { value: 'revolut', direction: 'out' }), name: 'Recarga' });
    expect(await repo.applyRules(outId)).toBe(3);
    expect(await transaction(repo, '08/10')).toMatchObject({ type: 'transfer', accountId: revolutId, toAccountId: bbvaId });
  });
});

describe('a rule with only a payee name', () => {
  it('sets the payee and leaves a transfer a transfer, even when it wins', async () => {
    const { repo, revolutId } = await setup();
    await repo.createRule(transferRule(revolutId));
    await repo.applyRules();
    // Created later, so it goes first and wins over the transfer rule.
    await repo.createRule({ name: 'Recarga', match: { value: 'revolut**' }, actions: { payeeName: 'Recarga Revolut' } });

    expect(await repo.applyRules()).toBe(3);

    for (const day of ['05/09', '20/09', '05/10']) {
      expect(await transaction(repo, day)).toMatchObject({ type: 'transfer', toAccountId: revolutId, payee: { name: 'Recarga Revolut' } });
    }
    expect((await balances(repo)).Revolut).toBe(45000);
  });

  it('leaves an expense an expense, with its category', async () => {
    const { repo } = await setup();
    const mercadona = await transaction(repo, '10/09');
    await repo.createRule({ name: 'Merca', match: { value: 'mercadona' }, actions: { payeeName: 'Merca' } });

    expect(await repo.applyRules()).toBe(2);
    expect(await transaction(repo, '10/09')).toMatchObject({ type: 'expense', categoryId: mercadona.categoryId, payee: { name: 'Merca' } });
  });
});

describe('transactions the user converted or un-converted by hand', () => {
  it('are never changed by applying rules', async () => {
    const { repo, revolutId, huchaId, ocio } = await setup();
    const transferId = await repo.createRule(transferRule(revolutId));
    await repo.applyRules(transferId);
    // "Quitar transferencia" on one rule-made transfer, and "Convertir en transferencia" on the edited charge.
    await repo.updateTransaction((await transaction(repo, '05/09')).id, { transferAccountId: null });
    await repo.updateTransaction((await transaction(repo, '15/10')).id, { transferAccountId: huchaId });

    // The transfer rule leaves the un-converted one an expense.
    expect(await repo.applyRules(transferId)).toBe(0);
    expect(await transaction(repo, '05/09')).toMatchObject({ type: 'expense', categoryId: null });

    // A category rule leaves the converted one a transfer, and reverts only the rule-made ones.
    await repo.updateRule(transferId, { enabled: false });
    const ruleId = await repo.createRule({ name: 'Revolut ocio', match: { value: 'revolut' }, actions: { categoryId: ocio } });
    expect(await repo.applyRules(ruleId)).toBe(3);
    expect(await transaction(repo, '15/10')).toMatchObject({ type: 'transfer', toAccountId: huchaId, categoryId: null });
    expect(await transaction(repo, '05/09')).toMatchObject({ type: 'expense', categoryId: null });
    expect((await balances(repo)).Hucha).toBe(15000);
  });
});

describe('deleting an account that rules transfer to', () => {
  it('removes the transfer action from those rules and disables them, keeping them to be repointed', async () => {
    const { repo, revolutId, huchaId } = await setup();
    const toHucha = await repo.createRule({ name: 'Hucha', match: { value: 'traspaso hucha' }, actions: { transferAccountId: huchaId } });
    const toHuchaNamed = await repo.createRule({
      name: 'Ahorro',
      match: { value: 'ahorro' },
      actions: { transferAccountId: huchaId, payeeName: 'Ahorro' },
    });
    const toRevolut = await repo.createRule(transferRule(revolutId));

    await repo.deleteAccount(huchaId);

    const rules = await repo.listRules();
    expect(rules.find((rule) => rule.id === toHucha)).toMatchObject({ enabled: false, actions: {} });
    expect(rules.find((rule) => rule.id === toHuchaNamed)).toMatchObject({ enabled: false, actions: { payeeName: 'Ahorro' } });
    expect(rules.find((rule) => rule.id === toHuchaNamed)!.actions.transferAccountId).toBeUndefined();
    expect(rules.find((rule) => rule.id === toRevolut)).toMatchObject({ enabled: true, actions: { transferAccountId: revolutId } });

    // The user can repoint it and enable it again.
    await repo.updateRule(toHucha, { enabled: true, actions: { transferAccountId: revolutId } });
    expect((await repo.listRules()).find((rule) => rule.id === toHucha)).toMatchObject({ enabled: true, actions: { transferAccountId: revolutId } });
  });

  it('changes no rule when the delete is refused', async () => {
    const { repo, revolutId } = await setup();
    await repo.createRule(transferRule(revolutId));
    await repo.applyRules();
    const before = await repo.listRules();

    await expect(repo.deleteAccount(revolutId)).rejects.toThrow();

    expect(await repo.listRules()).toEqual(before);
  });
});
