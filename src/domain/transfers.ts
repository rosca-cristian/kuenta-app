import type { Cents } from './money';
import type { Id, Transaction } from './model';

/** What an imported transaction is: its type and the accounts the money leaves and enters. */
export type ImportedShape = Pick<Transaction, 'type' | 'accountId' | 'toAccountId'>;

/**
 * What an imported transaction becomes, decided by the bank's sign as seen from the import
 * account. With a transfer account, a charge (negative) is a transfer from the import
 * account to it and a credit is a transfer from it to the import account; without one, a
 * charge is an expense and a credit an income of the import account. The bank's signed
 * amount on the import account stays the same either way, so the bank chain holds.
 */
export function shapeByBankSign(bankAmount: Cents, importAccountId: Id, transferAccountId: Id | null): ImportedShape {
  const charge = bankAmount < 0;
  if (transferAccountId === null) return { type: charge ? 'expense' : 'income', accountId: importAccountId, toAccountId: null };
  if (transferAccountId === importAccountId) throw new Error("A transfer can't have the same account on both sides");
  return charge
    ? { type: 'transfer', accountId: importAccountId, toAccountId: transferAccountId }
    : { type: 'transfer', accountId: transferAccountId, toAccountId: importAccountId };
}

/** The account on the other side of the import account in a transfer; null when it isn't a transfer. */
export function transferAccountOf(tx: ImportedShape, importAccountId: Id): Id | null {
  if (tx.type !== 'transfer') return null;
  return tx.accountId === importAccountId ? tx.toAccountId : tx.accountId;
}
