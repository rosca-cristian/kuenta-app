import { readSheet } from 'read-excel-file/universal';
import { parseBankAmount } from '../../domain/money';
import { parseBankDate, type IsoDate } from '../../domain/dates';
import { decodeEntities, normalizeText } from '../../domain/text';
import type { BankRow } from '../../domain/bankRow';

export type { BankRow };

export type ReadErrorCode = 'unreadable' | 'missing-columns' | 'currency' | 'invalid-row' | 'empty';

export interface ReadError {
  code: ReadErrorCode;
  message: string;
}

export type ReadResult =
  | { ok: true; rows: BankRow[]; generatedOn: IsoDate | null }
  | { ok: false; error: ReadError };

const REQUIRED = {
  valueDate: 'fecha valor',
  bookingDate: 'fecha',
  concept: 'concepto',
  amount: 'importe',
  balance: 'disponible',
} as const;

const OPTIONAL = { movement: 'movimiento', observations: 'observaciones' } as const;

type Column = keyof typeof REQUIRED | keyof typeof OPTIONAL | 'amountCurrency' | 'balanceCurrency';

const LABELS: Record<keyof typeof REQUIRED, string> = {
  valueDate: 'Fecha valor',
  bookingDate: 'Fecha',
  concept: 'Concepto',
  amount: 'Importe',
  balance: 'Disponible',
};

const fail = (code: ReadErrorCode, message: string): ReadResult => ({ ok: false, error: { code, message } });

const cellText = (value: unknown): string =>
  value === null || value === undefined ? '' : decodeEntities(String(value)).trim();

function findColumns(header: unknown[]): Partial<Record<Column, number>> {
  const names = header.map((cell) => normalizeText(cellText(cell)));
  const columns: Partial<Record<Column, number>> = {};
  for (const [key, name] of Object.entries({ ...REQUIRED, ...OPTIONAL })) {
    const index = names.indexOf(name);
    if (index >= 0) columns[key as Column] = index;
  }
  // "Divisa" appears twice: one belongs to Importe, the other to Disponible.
  names.forEach((name, index) => {
    if (name !== 'divisa') return;
    if (columns.amount !== undefined && index === columns.amount + 1) columns.amountCurrency = index;
    if (columns.balance !== undefined && index === columns.balance + 1) columns.balanceCurrency = index;
  });
  return columns;
}

/** Parses the cells of the sheet. Exposed separately so it can run on any grid. */
export function parseBbvaSheet(grid: unknown[][]): ReadResult {
  const headerIndex = grid.findIndex((row) => {
    const names = row.map((cell) => normalizeText(cellText(cell)));
    return names.includes('fecha valor') || (names.includes('concepto') && names.includes('importe'));
  });
  if (headerIndex < 0) {
    return fail('missing-columns', 'No se encuentra la fila de cabecera (Fecha valor, Fecha, Concepto, Importe, Disponible).');
  }

  const columns = findColumns(grid[headerIndex]);
  const missing = (Object.keys(REQUIRED) as (keyof typeof REQUIRED)[]).filter((key) => columns[key] === undefined);
  if (missing.length > 0) {
    return fail('missing-columns', `Faltan columnas en el archivo: ${missing.map((key) => LABELS[key]).join(', ')}.`);
  }

  let generatedOn: IsoDate | null = null;
  for (const row of grid.slice(0, headerIndex)) {
    for (const cell of row) {
      const match = /informe:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(cellText(cell));
      if (match) generatedOn = parseBankDate(match[1]);
    }
  }

  const rows: BankRow[] = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const cells = grid[i];
    const get = (column: Column) => (columns[column] === undefined ? '' : cells[columns[column]!]);
    if ([get('valueDate'), get('bookingDate'), get('concept'), get('amount')].every((v) => cellText(v) === '')) continue;

    for (const currencyColumn of ['amountCurrency', 'balanceCurrency'] as const) {
      const currency = cellText(get(currencyColumn)).toUpperCase();
      if (currency !== '' && currency !== 'EUR') {
        return fail('currency', `La fila ${i + 1} está en ${currency}. Kuenta solo admite euros.`);
      }
    }

    const valueDate = parseBankDate(get('valueDate'));
    const bookingDate = parseBankDate(get('bookingDate'));
    const amount = parseBankAmount(get('amount'));
    const balance = parseBankAmount(get('balance'));
    if (!valueDate || !bookingDate || amount === null || balance === null) {
      return fail('invalid-row', `La fila ${i + 1} no tiene una fecha, un importe o un disponible válidos.`);
    }

    rows.push({
      valueDate,
      bookingDate,
      concept: cellText(get('concept')),
      movement: cellText(get('movement')),
      amount,
      balance,
      observations: cellText(get('observations')),
    });
  }

  if (rows.length === 0) return fail('empty', 'El archivo no tiene movimientos.');
  return { ok: true, rows, generatedOn };
}

/** Reads a BBVA "Movimientos" .xlsx (as exported through Google Sheets). Rows come newest first, as in the file. */
export async function readBbvaFile(input: Blob | ArrayBuffer): Promise<ReadResult> {
  let grid: unknown[][];
  try {
    // Keep numbers as the exact text stored in the file, to convert them to cents without floats.
    grid = (await readSheet(input, { parseNumber: (text: string) => text, trim: false })) as unknown[][];
  } catch {
    return fail('unreadable', 'No se puede leer el archivo. Debe ser el Excel (.xlsx) de movimientos de BBVA.');
  }
  return parseBbvaSheet(grid);
}
