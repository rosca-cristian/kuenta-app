import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

async function setup() {
  const repo = createDexieRepository({ name: `kuenta-manage-rules-${++dbCount}`, now: () => new Date('2026-10-20T10:00:00') });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return repo;
}

async function importFile(repo: DataRepository, movements: SampleMovement[]) {
  const result = await repo.previewImport(await bbvaXlsx(movements), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return repo.commitImport(result.preview);
}

async function categoryId(repo: DataRepository, name: string) {
  const category = (await repo.listCategories()).find((c) => c.name === name);
  if (!category) throw new Error(`No category ${name}`);
  return category.id;
}

async function categoryOf(repo: DataRepository, concept: string, month = '2026-09') {
  const tx = (await repo.listTransactions(month)).find((t) => t.bankConcept === concept);
  if (!tx) throw new Error(`No transaction with concept ${concept}`);
  return tx.category?.name ?? null;
}

const ruleNames = async (repo: DataRepository) => (await repo.listRules()).map((rule) => rule.name);

describe('reordering rules', () => {
  it('moves a rule up or down, which changes the rule that wins on the next import', async () => {
    const repo = await setup();
    await repo.createRule({ name: 'Mercadona es ocio', match: { value: 'mercadona' }, actions: { categoryId: await categoryId(repo, 'Ocio') } });
    expect((await ruleNames(repo)).slice(0, 3)).toEqual(['Mercadona es ocio', 'Mercadona', 'Carrefour']);

    const [mine] = await repo.listRules();
    await repo.moveRule(mine.id, 'down');
    expect((await ruleNames(repo)).slice(0, 3)).toEqual(['Mercadona', 'Mercadona es ocio', 'Carrefour']);

    await importFile(repo, [{ valor: '01/09/2026', concepto: 'Mercadona', importe: -20 }]);
    expect(await categoryOf(repo, 'Mercadona')).toBe('Supermercado');

    await repo.moveRule(mine.id, 'up');
    expect((await ruleNames(repo)).slice(0, 2)).toEqual(['Mercadona es ocio', 'Mercadona']);
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Mercadona', importe: -20 },
      { valor: '02/09/2026', concepto: 'Mercadona centro', importe: -5 },
    ]);
    expect(await categoryOf(repo, 'Mercadona centro')).toBe('Ocio');
  });

  it('leaves the first rule and the last one where they are', async () => {
    const repo = await setup();
    const before = await ruleNames(repo);
    const rules = await repo.listRules();
    await repo.moveRule(rules[0].id, 'up');
    await repo.moveRule(rules[rules.length - 1].id, 'down');
    expect(await ruleNames(repo)).toEqual(before);
  });
});

describe('deleting a rule', () => {
  it('removes it from the list and leaves the categories and payees it set untouched', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Mercadona', importe: -20 },
      { valor: '02/09/2026', concepto: 'Www.amazon*nv14y8j34', importe: -15 },
    ]);
    const rules = await repo.listRules();
    const mercadona = rules.find((rule) => rule.name === 'Mercadona')!;
    const amazon = rules.find((rule) => rule.name === 'Amazon')!;

    await repo.deleteRule(mercadona.id);
    await repo.deleteRule(amazon.id);

    expect(await ruleNames(repo)).toEqual(rules.filter((rule) => rule !== mercadona && rule !== amazon).map((rule) => rule.name));
    expect(await categoryOf(repo, 'Mercadona')).toBe('Supermercado');
    const amazonTx = (await repo.listTransactions('2026-09')).find((tx) => tx.bankConcept === 'Www.amazon*nv14y8j34')!;
    expect(amazonTx).toMatchObject({ category: { name: 'Compras' }, payee: { name: 'Amazon' } });

    // The next import no longer files new Mercadona purchases.
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Mercadona', importe: -20 },
      { valor: '02/09/2026', concepto: 'Www.amazon*nv14y8j34', importe: -15 },
      { valor: '03/09/2026', concepto: 'Mercadona centro', importe: -5 },
    ]);
    expect(await categoryOf(repo, 'Mercadona centro')).toBeNull();
  });
});

describe('saving a rule', () => {
  it('places a new rule before every other, starter rules included', async () => {
    const repo = await setup();
    const starters = await ruleNames(repo);
    const ocio = await categoryId(repo, 'Ocio');
    await repo.createRule({ name: 'Cine', match: { value: 'cine' }, actions: { categoryId: ocio } });
    await repo.createRule({ name: 'Teatro', match: { value: 'teatro' }, actions: { categoryId: ocio } });
    expect(await ruleNames(repo)).toEqual(['Teatro', 'Cine', ...starters]);
  });

  it('refuses a rule without text or without any action, saving nothing', async () => {
    const repo = await setup();
    const before = await repo.listRules();
    const ocio = await categoryId(repo, 'Ocio');
    await expect(repo.createRule({ name: 'Vacía', match: { value: '  ' }, actions: { categoryId: ocio } })).rejects.toThrow();
    await expect(repo.createRule({ name: 'Cine', match: { value: 'cine' }, actions: {} })).rejects.toThrow();
    await expect(repo.createRule({ name: 'Cine', match: { value: 'cine' }, actions: { payeeName: ' ' } })).rejects.toThrow();

    const mercadona = before.find((rule) => rule.name === 'Mercadona')!;
    await expect(repo.updateRule(mercadona.id, { match: { value: '' } })).rejects.toThrow();
    await expect(repo.updateRule(mercadona.id, { actions: {} })).rejects.toThrow();
    expect(await repo.listRules()).toEqual(before);
  });

  it('keeps a rule left without an action disabled until it gets one', async () => {
    const repo = await setup();
    await repo.deleteCategory(await categoryId(repo, 'Supermercado'), null);
    const mercadona = (await repo.listRules()).find((rule) => rule.name === 'Mercadona')!;
    expect(mercadona).toMatchObject({ enabled: false, actions: {} });

    await expect(repo.updateRule(mercadona.id, { enabled: true })).rejects.toThrow();
    expect((await repo.listRules()).find((rule) => rule.id === mercadona.id)!.enabled).toBe(false);

    await repo.updateRule(mercadona.id, { enabled: true, actions: { categoryId: await categoryId(repo, 'Compras') } });
    expect((await repo.listRules()).find((rule) => rule.id === mercadona.id)).toMatchObject({ enabled: true });
    await importFile(repo, [{ valor: '01/09/2026', concepto: 'Mercadona', importe: -20 }]);
    expect(await categoryOf(repo, 'Mercadona')).toBe('Compras');
  });
});
