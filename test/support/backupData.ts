import type { DataRepository } from '../../src/data/repository';
import type { KuentaDb } from '../../src/data/dexie/db';
import { bbvaXlsx, type SampleMovement } from './bbvaXlsx';

// The rich data and helpers shared by the backup, restore and privacy mode tests.

export async function importFile(repo: DataRepository, movements: SampleMovement[], startBalance: number) {
  const result = await repo.previewImport(await bbvaXlsx(movements, { startBalance }), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return repo.commitImport(result.preview);
}

export async function transactionId(repo: DataRepository, concept: string) {
  const tx = (await repo.listTransactions(null)).find((t) => t.bankConcept === concept);
  if (!tx) throw new Error(`No transaction ${concept}`);
  return tx.id;
}

/**
 * Data touching every table: an import with categorizations, a note and a renamed payee; a
 * Bizum paying back part of the bakery; a rule applied to it; a transfer to a non-imported account and a balance adjustment there; a
 * budget with two limits; a monthly savings target changed from a month on; a goal, an archived one and one without target month on an archived
 * account; a transfer rule and a rule disabled by deleting its category; an archived category
 * and the starter-rules offer closed; and a second import, undone. The repository can't archive
 * a category nor close an offer no update made, so those two go straight into `db`.
 */
export async function richData(repo: DataRepository, db: KuentaDb) {
  await importFile(
    repo,
    [
      { valor: '01/10/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
      { valor: '02/10/2026', concepto: 'Mercadona - crta del inge', movimiento: 'Pago con tarjeta', importe: -50 },
      { valor: '03/10/2026', concepto: 'Panaderia Pepe', movimiento: 'Pago con tarjeta', importe: -3.2 },
      { valor: '04/10/2026', concepto: 'Bizum', movimiento: 'Recibido: pan', importe: 2 },
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
  const bizum = (await repo.listTransactions(null)).find((t) => t.bankMovement === 'Recibido: pan')!.id;
  await repo.setReimbursements(bizum, [{ expenseId: await transactionId(repo, 'Panaderia Pepe'), amount: 150 }]);
  await repo.updateTransaction(await transactionId(repo, 'Revolut**5625*'), { transferAccountId: revolutId });
  // Revolut got 200 €; it really has 180 €: an adjustment of −20 € today.
  await repo.updateAccountBalance(revolutId, 18000);
  await repo.setBudgetLimit(groceries, 30000, '2026-09');
  await repo.setBudgetLimit(groceries, 25000, '2026-10');
  await repo.setSavingsTarget(30000, '2026-09');
  await repo.setSavingsTarget(20000);
  const { id: carId } = (await repo.createGoal({ name: 'Coche', target: 500000, targetMonth: '2026-09', accountId: revolutId, icon: 'car', color: 'cyan' })) as {
    id: string;
  };
  await repo.setGoalArchived(carId, true);
  await repo.createGoal({ name: 'Viaje', target: 100000, targetMonth: '2027-06', accountId: revolutId, icon: 'plane', color: 'cyan' });

  // A savings account with a goal and no target month, a rule moving money there, then archived.
  const { id: savingsId } = (await repo.createAccount({ name: 'Hucha', type: 'savings', icon: 'piggy-bank', color: 'pink', openingBalance: 30000 })) as {
    id: string;
  };
  await repo.createGoal({ name: 'Colchón', target: 300000, accountId: savingsId, icon: 'piggy-bank', color: 'pink' });
  await repo.createRule({ name: 'A la hucha', match: { value: 'traspaso hucha', direction: 'out' }, actions: { transferAccountId: savingsId } });
  await repo.setAccountArchived(savingsId, true);

  // A rule whose category was deleted: disabled, without an action.
  const { id: petsId } = (await repo.createCategory({ name: 'Mascotas', kind: 'expense', icon: 'dog', color: 'amber' })) as { id: string };
  await repo.createRule({ name: 'Veterinario', match: { value: 'veterinario' }, actions: { categoryId: petsId } });
  await repo.deleteCategory(petsId, null);

  const { id: oldId } = (await repo.createCategory({ name: 'Antigua', kind: 'income', icon: 'ellipsis', color: 'gray' })) as { id: string };
  await db.categories.update(oldId, { archived: true });
  await db.settings.put({ key: 'starterRulesOffer', value: 'done' });

  const second = await importFile(repo, [{ valor: '10/10/2026', concepto: 'Gasolinera', movimiento: 'Pago con tarjeta', importe: -40 }], 2248.8);
  await repo.undoImport(second.batch.id);
}
