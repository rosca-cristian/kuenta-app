import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

/** A fresh install with the named starter rules disabled, so their merchants arrive uncategorized. */
async function setup(disable: string[] = []) {
  const repo = createDexieRepository({ name: `kuenta-suggestion-${++dbCount}`, now: () => new Date('2026-10-20T10:00:00') });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  for (const rule of await repo.listRules()) {
    if (disable.includes(rule.name)) await repo.updateRule(rule.id, { enabled: false });
  }
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

async function transactions(repo: DataRepository, concept: string) {
  return (await repo.listTransactions('2026-09')).filter((t) => t.bankConcept === concept);
}

/** Categorizes the first transaction with this concept by hand, as the edit sheet does, and returns it. */
async function categorize(repo: DataRepository, concept: string, category: string) {
  const [tx] = await transactions(repo, concept);
  await repo.updateTransaction(tx.id, { categoryId: await categoryId(repo, category) });
  return tx;
}

describe('rule suggestion after categorizing a transaction', () => {
  it('proposes the concept cut at the first dash, and counts the other uncategorized transactions of the payee', async () => {
    const repo = await setup(['Mercadona']);
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Mercadona - crta del inge', importe: -20 },
      { valor: '02/09/2026', concepto: 'Mercadona - crta del inge', importe: -30 },
      { valor: '03/09/2026', concepto: 'Mercadona - crta del inge', importe: -40 },
      { valor: '04/09/2026', concepto: 'Kfc', importe: -9 },
    ]);
    const tx = await categorize(repo, 'Mercadona - crta del inge', 'Supermercado');

    expect(await repo.ruleSuggestion(tx.id)).toEqual({ text: 'mercadona', others: 2 });
  });

  it('cuts an order code at the first asterisk', async () => {
    const repo = await setup(['Amazon']);
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Www.amazon*nv14y8j34', importe: -20 },
      { valor: '02/09/2026', concepto: 'Www.amazon*nm1zi14p4', importe: -30 },
    ]);
    // Each order code made its own payee; the user merged them in Comercios.
    const payees = await repo.listPayees();
    await repo.mergePayees(
      payees[0].id,
      payees.map((payee) => payee.id),
    );
    const tx = await categorize(repo, 'Www.amazon*nv14y8j34', 'Compras');

    expect(await repo.ruleSuggestion(tx.id)).toEqual({ text: 'www.amazon', others: 1 });
  });

  it('cuts at the first digit and leaves out accents and capitals', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Panadería  PEPE 1234 madrid', importe: -2 },
      { valor: '02/09/2026', concepto: 'Panadería  PEPE 1234 madrid', importe: -3 },
    ]);
    const tx = await categorize(repo, 'Panadería  PEPE 1234 madrid', 'Supermercado');

    expect(await repo.ruleSuggestion(tx.id)).toEqual({ text: 'panaderia pepe', others: 1 });
  });

  it('counts only the uncategorized transactions of the same payee the user never edited', async () => {
    const repo = await setup(['Mercadona']);
    await repo.createRule({ name: 'Online', match: { value: 'compra online', field: 'movement' }, actions: { categoryId: await categoryId(repo, 'Compras') } });
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Mercadona', importe: -10 },
      { valor: '02/09/2026', concepto: 'Mercadona', importe: -20 },
      { valor: '03/09/2026', concepto: 'Mercadona', importe: -30 },
      { valor: '04/09/2026', concepto: 'Mercadona', movimiento: 'Compra online', importe: -40 },
      { valor: '05/09/2026', concepto: 'Mercadona', importe: -50 },
      { valor: '06/09/2026', concepto: 'Mercadona sl', importe: -60 },
    ]);
    const byAmount = async (euros: number) => (await transactions(repo, 'Mercadona')).find((t) => t.amount === euros * 100)!;
    // Categorized by hand, or only given a note by hand: neither counts.
    await repo.updateTransaction((await byAmount(20)).id, { categoryId: await categoryId(repo, 'Ocio') });
    await repo.updateTransaction((await byAmount(30)).id, { note: 'compra grande' });
    const first = await byAmount(10);
    await repo.updateTransaction(first.id, { categoryId: await categoryId(repo, 'Supermercado') });

    // Left: the 50 € one. The 40 € one has a category from a rule; "Mercadona sl" is another payee.
    expect(await repo.ruleSuggestion(first.id)).toEqual({ text: 'mercadona', others: 1 });
  });

  it('suggests nothing when no other transaction of the payee is left uncategorized', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Kfc', importe: -9 },
      { valor: '02/09/2026', concepto: 'Burger', importe: -9 },
    ]);
    const tx = await categorize(repo, 'Kfc', 'Restaurantes');
    expect(await repo.ruleSuggestion(tx.id)).toBeNull();
  });

  it('suggests nothing for a Bizum', async () => {
    const repo = await setup();
    // Bizums arrive without a payee; a rule gives these two the friend's name.
    await repo.createRule({ name: 'Ana', match: { value: 'ana garcia', field: 'movement' }, actions: { payeeName: 'Ana' } });
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Bizum', movimiento: 'Recibido: Ana Garcia cena', importe: 15 },
      { valor: '02/09/2026', concepto: 'Bizum', movimiento: 'Recibido: Ana Garcia cine', importe: 8 },
    ]);
    const tx = await categorize(repo, 'Bizum', 'Otros ingresos');
    expect(tx.payee?.name).toBe('Ana');
    expect(await repo.ruleSuggestion(tx.id)).toBeNull();
  });

  it('suggests nothing when the concept starts with a digit', async () => {
    const repo = await setup();
    await importFile(repo, [
      { valor: '01/09/2026', concepto: '24h tienda', importe: -2 },
      { valor: '02/09/2026', concepto: '24h tienda', importe: -3 },
    ]);
    const tx = await categorize(repo, '24h tienda', 'Supermercado');
    expect(await repo.ruleSuggestion(tx.id)).toBeNull();
  });
});

describe('accepting a rule suggestion', () => {
  it('creates a rule that wins over starter rules and categorizes the rest of the payee at once', async () => {
    const repo = await setup(['Mercadona']);
    await importFile(repo, [
      { valor: '01/10/2026', concepto: 'Mercadona - crta del inge', importe: -20 },
      { valor: '02/10/2026', concepto: 'Mercadona - crta del inge', importe: -30 },
      { valor: '03/10/2026', concepto: 'Mercadona - crta del inge', importe: -40 },
    ]);
    const [tx] = (await repo.listTransactions('2026-10')).filter((t) => t.bankConcept === 'Mercadona - crta del inge');
    const leisure = await categoryId(repo, 'Ocio');
    await repo.updateTransaction(tx.id, { categoryId: leisure });
    const suggestion = (await repo.ruleSuggestion(tx.id))!;

    // What the quick rule sheet does: show the live count, then create and apply the rule.
    expect(await repo.previewRule({ match: { value: suggestion.text }, actions: { categoryId: leisure } })).toEqual({ matching: 3, applicable: 2 });
    const rule = await repo.createRule({ name: 'Mercadona', match: { value: suggestion.text }, actions: { categoryId: leisure } });
    expect(await repo.applyRules(rule)).toBe(2);

    expect((await repo.listTransactions('2026-10')).map((t) => t.category?.name)).toEqual(['Ocio', 'Ocio', 'Ocio']);
    expect((await repo.home('2026-10')).uncategorized).toBe(0);
    expect((await repo.listRules())[0].id).toBe(rule);
  });

  it('changes nothing when dismissed: asking for a suggestion writes nothing', async () => {
    const repo = await setup(['Mercadona']);
    await importFile(repo, [
      { valor: '01/09/2026', concepto: 'Mercadona', importe: -20 },
      { valor: '02/09/2026', concepto: 'Mercadona', importe: -30 },
    ]);
    const tx = await categorize(repo, 'Mercadona', 'Supermercado');
    const rulesBefore = await repo.listRules();
    const txsBefore = await repo.listTransactions('2026-09');

    expect(await repo.ruleSuggestion(tx.id)).not.toBeNull();
    expect(await repo.listRules()).toEqual(rulesBefore);
    expect(await repo.listTransactions('2026-09')).toEqual(txsBefore);
  });
});
