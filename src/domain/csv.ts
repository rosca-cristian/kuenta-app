import type { Cents } from './money';
import { formatDate, type IsoDate } from './dates';
import { signedAmount, TX_TYPE_NAMES, type Transaction } from './model';

/** What the CSV needs of a transaction: the repository's transaction views have it all. */
export type CsvTransaction = Pick<
  Transaction,
  'type' | 'amount' | 'date' | 'accountId' | 'toAccountId' | 'note' | 'source' | 'bankConcept'
> & {
  account: { name: string };
  toAccount: { name: string } | null;
  category: { name: string } | null;
  payee: { name: string } | null;
};

const BOM = '\uFEFF';
const EOL = '\r\n';
const HEADER = ['Fecha', 'Tipo', 'Cuenta', 'Cuenta destino', 'Categoría', 'Comercio', 'Nota', 'Importe', 'Concepto banco'];

/** `kuenta-movimientos-2026-10-20.csv` for an export made that day. */
export const csvFileName = (date: IsoDate) => `kuenta-movimientos-${date}.csv`;

/** Cents as a number Spanish Excel reads: −1250 → "-12,50", 150000 → "1500,00" (no thousands separator, no "€"). */
function csvAmount(cents: Cents): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Text a spreadsheet would run as a formula gets a leading `'`, so it stays text. */
const guarded = (text: string) => (/^[=+\-@]/.test(text) ? `'${text}` : text);

/** A field with the separator, a quote or a line break goes in quotes, its quotes doubled. */
const escaped = (field: string) => (/[;"\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field);

function typeLabel(tx: CsvTransaction): string {
  if (tx.source === 'adjustment') return 'Ajuste de saldo';
  return TX_TYPE_NAMES[tx.type];
}

/**
 * The CSV export of `docs/spec.md` §5.13, for Spanish Excel: UTF-8 with BOM, `;` separator,
 * CRLF after every line, one line per transaction. It takes the transactions in Movimientos'
 * order, newest first as `listTransactions` returns them, and writes them oldest first. The
 * amount is signed from the transaction's account, so a transfer is negative (the money
 * leaves that account).
 */
export function transactionsCsv(transactions: CsvTransaction[]): string {
  const lines = [...transactions].reverse().map((tx) =>
    [
      formatDate(tx.date),
      typeLabel(tx),
      guarded(tx.account.name),
      guarded(tx.type === 'transfer' ? (tx.toAccount?.name ?? '') : ''),
      guarded(tx.category?.name ?? ''),
      guarded(tx.payee?.name ?? ''),
      guarded(tx.note),
      csvAmount(signedAmount(tx, tx.accountId)),
      guarded(tx.bankConcept ?? ''),
    ]
      .map(escaped)
      .join(';'),
  );
  return BOM + [HEADER.join(';'), ...lines].map((line) => line + EOL).join('');
}
