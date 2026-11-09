import type { Cents } from './money';
import { formatDate, type IsoDate } from './dates';
import { signedAmount, TX_TYPE_NAMES, type CashExpense, type Transaction } from './model';

/** What the CSV needs of a transaction: the repository's transaction views have it all. */
export type CsvTransaction = Pick<
  Transaction,
  'type' | 'amount' | 'date' | 'accountId' | 'toAccountId' | 'note' | 'source' | 'bankConcept'
> & {
  account: { name: string };
  toAccount: { name: string } | null;
  category: { name: string } | null;
  payee: { name: string } | null;
  /** What was paid back of an expense, or what an income pays back. */
  reimbursement: { paidBack: Cents; spread: Cents } | null;
  /** A bank row, as opposed to a cash expense. */
  kind?: 'bank';
  /** Set for a cash withdrawal, whose Tipo is "Retirada de efectivo". */
  cash?: object | null;
};

/** What the CSV needs of a cash expense: the repository's cash expense views have it all. */
export type CsvCashExpense = Pick<CashExpense, 'amount' | 'date' | 'note'> & { kind: 'cash'; category: { name: string } | null };

/** One line of the CSV: a transaction or a cash expense, as Movimientos lists them. */
export type CsvRow = CsvTransaction | CsvCashExpense;

const BOM = '\uFEFF';
const EOL = '\r\n';
const HEADER = ['Fecha', 'Tipo', 'Cuenta', 'Cuenta destino', 'Categoría', 'Comercio', 'Nota', 'Importe', 'Reembolsado', 'Concepto banco'];

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
  if (tx.cash) return 'Retirada de efectivo';
  return TX_TYPE_NAMES[tx.type];
}

/** A transaction's fields, in the header's order. */
function transactionFields(tx: CsvTransaction): string[] {
  return [
    formatDate(tx.date),
    typeLabel(tx),
    guarded(tx.account.name),
    guarded(tx.type === 'transfer' ? (tx.toAccount?.name ?? '') : ''),
    guarded(tx.category?.name ?? ''),
    guarded(tx.payee?.name ?? ''),
    guarded(tx.note),
    csvAmount(signedAmount(tx, tx.accountId)),
    reimbursed(tx),
    guarded(tx.bankConcept ?? ''),
  ];
}

/** A cash expense's fields: paid from the "Efectivo" pocket, with no payee, reimbursement or bank concept. */
function cashExpenseFields(expense: CsvCashExpense): string[] {
  return [formatDate(expense.date), 'Gasto en efectivo', 'Efectivo', '', guarded(expense.category?.name ?? ''), '', guarded(expense.note), csvAmount(-expense.amount), '', ''];
}

/** The part of an expense paid back, or of an income spread over expenses; empty when none. */
function reimbursed(tx: CsvTransaction): string {
  const part = (tx.reimbursement?.paidBack ?? 0) + (tx.reimbursement?.spread ?? 0);
  return part > 0 ? csvAmount(part) : '';
}

/**
 * The CSV export of `docs/spec.md` §5.13, for Spanish Excel: UTF-8 with BOM, `;` separator,
 * CRLF after every line, one line per row. It takes the rows in Movimientos' order, newest
 * first as `listMovements` returns them, and writes them oldest first. The amount is signed
 * from the transaction's account, so a transfer is negative (the money leaves that account).
 * "Reembolsado" is what was paid back of an expense or what an income pays back, positive,
 * and empty without reimbursements; the amount stays the bank's. A cash withdrawal's Tipo is
 * "Retirada de efectivo", and a cash expense is its own line ("Gasto en efectivo", account
 * "Efectivo"), so a spreadsheet can tell them apart and not count the cash twice.
 */
export function transactionsCsv(rows: CsvRow[]): string {
  const lines = [...rows].reverse().map((row) => (row.kind === 'cash' ? cashExpenseFields(row) : transactionFields(row)).map(escaped).join(';'));
  return BOM + [HEADER.join(';'), ...lines].map((line) => line + EOL).join('');
}
