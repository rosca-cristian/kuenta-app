import { describe, expect, it } from 'vitest';
import { csvFileName, transactionsCsv, type CsvTransaction } from './csv';

const BBVA = 'bbva';
const HEADER = 'Fecha;Tipo;Cuenta;Cuenta destino;Categoría;Comercio;Nota;Importe;Concepto banco';

/** An imported expense of BBVA on 20/10/2026, as the repository's views have it. */
function tx(overrides: Partial<CsvTransaction> = {}): CsvTransaction {
  return {
    type: 'expense',
    amount: 1250,
    date: '2026-10-20',
    accountId: BBVA,
    toAccountId: null,
    note: '',
    source: 'import',
    bankConcept: 'Mercadona',
    account: { name: 'BBVA' },
    toAccount: null,
    category: { name: 'Supermercado' },
    payee: { name: 'Mercadona' },
    ...overrides,
  };
}

/** The CSV's lines after the header, without the BOM or line endings. */
const lines = (transactions: CsvTransaction[]) => transactionsCsv(transactions).split('\r\n').slice(1, -1);

describe('the CSV export', () => {
  it('starts with a UTF-8 BOM and the header, and ends every line, the last one too, with CRLF', () => {
    const csv = transactionsCsv([tx(), tx({ date: '2026-10-21' })]);
    expect(csv.startsWith(`\uFEFF${HEADER}\r\n`)).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(4);
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('is only the BOM and the header without transactions', () => {
    expect(transactionsCsv([])).toBe(`\uFEFF${HEADER}\r\n`);
  });

  it('writes the date as dd/mm/aaaa and the signed amount with a decimal comma, no thousands separator or "€"', () => {
    expect(lines([tx()])).toEqual(['20/10/2026;Gasto;BBVA;;Supermercado;Mercadona;;-12,50;Mercadona']);
    expect(lines([tx({ type: 'income', amount: 150000, category: { name: 'Nómina' }, payee: null, bankConcept: 'Abono de nómina' })])).toEqual([
      '20/10/2026;Ingreso;BBVA;;Nómina;;;1500,00;Abono de nómina',
    ]);
    expect(lines([tx({ amount: 5 })])[0]).toContain(';-0,05;');
    expect(lines([tx({ amount: 123456789 })])[0]).toContain(';-1234567,89;');
  });

  it('names the type: Gasto, Ingreso, Transferencia, or Ajuste de saldo for an adjustment', () => {
    const adjustment = tx({ type: 'income', source: 'adjustment', note: 'Ajuste de saldo', category: null, payee: null, bankConcept: null });
    expect(lines([adjustment])).toEqual(['20/10/2026;Ajuste de saldo;BBVA;;;;Ajuste de saldo;12,50;']);
    expect(lines([tx({ type: 'expense', source: 'adjustment', category: null })])[0]).toMatch(/^20\/10\/2026;Ajuste de saldo;.*;-12,50;/);
  });

  it("writes a transfer's other account and signs it from its account, so it's negative whichever way it went", () => {
    const outgoing = tx({ type: 'transfer', amount: 20000, toAccountId: 'revolut', toAccount: { name: 'Revolut' }, category: null, payee: null, bankConcept: 'Revolut**5625*' });
    const incoming = tx({
      type: 'transfer',
      amount: 8000,
      accountId: 'revolut',
      account: { name: 'Revolut' },
      toAccountId: BBVA,
      toAccount: { name: 'BBVA' },
      category: null,
      payee: null,
      date: '2026-10-21',
      bankConcept: 'Transferencia recibida',
    });
    expect(lines([incoming, outgoing])).toEqual([
      '20/10/2026;Transferencia;BBVA;Revolut;;;;-200,00;Revolut**5625*',
      '21/10/2026;Transferencia;Revolut;BBVA;;;;-80,00;Transferencia recibida',
    ]);
  });

  it('leaves the other account empty when it isn’t a transfer, and category, payee, note and concept when absent', () => {
    const bare = tx({ toAccount: { name: 'Revolut' }, category: null, payee: null, note: '', bankConcept: null });
    expect(lines([bare])).toEqual(['20/10/2026;Gasto;BBVA;;;;;-12,50;']);
  });

  it('writes them oldest first: Movimientos’ newest-first order reversed', () => {
    const newest = tx({ date: '2026-10-21', bankConcept: 'Lidl' });
    const oldest = tx({ date: '2026-09-30', bankConcept: 'Septiembre' });
    expect(lines([newest, tx(), oldest]).map((line) => line.split(';')[8])).toEqual(['Septiembre', 'Mercadona', 'Lidl']);
  });

  it('quotes a field with a semicolon, a quote or a line break, doubling its quotes', () => {
    const note = (text: string) => lines([tx({ note: text })])[0].split(';').slice(6, -2).join(';');
    expect(note('Cena; con Laura')).toBe('"Cena; con Laura"');
    expect(note('El "bueno"')).toBe('"El ""bueno"""');
    expect(note('Línea 1\nlínea 2')).toBe('"Línea 1\nlínea 2"');
    expect(note('Línea 1\rlínea 2')).toBe('"Línea 1\rlínea 2"');
    expect(note('Sin nada raro')).toBe('Sin nada raro');
    // CRLF inside a quoted note, so the line itself isn't split by it.
    expect(transactionsCsv([tx({ note: 'a\r\nb' })])).toContain(';"a\r\nb";-12,50;');
  });

  it('puts a quote mark before text a spreadsheet would run as a formula, but leaves amounts alone', () => {
    const line = lines([
      tx({ account: { name: '=Cuenta' }, category: { name: '+Categoría' }, payee: { name: '@Comercio' }, note: '-nota', bankConcept: '=HYPERLINK("x")' }),
    ])[0];
    expect(line).toBe(`20/10/2026;Gasto;'=Cuenta;;'+Categoría;'@Comercio;'-nota;-12,50;"'=HYPERLINK(""x"")"`);
    expect(lines([tx({ note: 'nota = 3' })])[0]).toContain(';nota = 3;');
  });

  it('names the file with the date', () => {
    expect(csvFileName('2026-10-20')).toBe('kuenta-movimientos-2026-10-20.csv');
  });
});
