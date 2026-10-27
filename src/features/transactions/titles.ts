import type { TransactionView } from '../../data/repository';

/** What a transaction is called in lists: its payee, else its note (a Bizum's), else the bank concept. */
export function transactionTitle(tx: TransactionView): string {
  return tx.payee?.name || tx.note || tx.bankConcept || 'Movimiento';
}
