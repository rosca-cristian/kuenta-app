import ExcelJS from 'exceljs';

/**
 * Builds synthetic BBVA "Movimientos" files with the exact structure of the real
 * export saved through Google Sheets: sheet "Informe BBVA", a logo, title rows,
 * the header at B5, a duplicated "Divisa" column, numeric amounts and text dates.
 * Real statements never enter the repository.
 */

export interface SampleMovement {
  /** dd/mm/aaaa */
  valor: string;
  /** dd/mm/aaaa; defaults to the value date. */
  fecha?: string;
  concepto: string;
  movimiento?: string;
  /** Euros, signed. */
  importe: number;
  divisa?: string;
  /** Overrides the computed "Disponible" to simulate broken files. */
  disponible?: number;
}

export interface SampleFileOptions {
  /** "Disponible" before the oldest movement, in euros. */
  startBalance?: number;
  generatedOn?: string;
  /** Header names to leave out, to simulate malformed files. */
  omitColumns?: string[];
}

const HEADER = ['Fecha valor', 'Fecha', 'Concepto', 'Movimiento', 'Importe', 'Divisa', 'Disponible', 'Divisa', 'Observaciones'];

// 1×1 transparent PNG, standing in for the BBVA logo.
const LOGO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * Movements are given oldest first, as you'd think of them. Like the bank, the file
 * orders them by booking date (newest first) and chains "Disponible" in that order.
 */
export async function bbvaXlsx(movements: SampleMovement[], options: SampleFileOptions = {}): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Informe BBVA');
  const logo = workbook.addImage({ buffer: LOGO as unknown as ExcelJS.Buffer, extension: 'png' });
  sheet.addImage(logo, { tl: { col: 1, row: 0 }, ext: { width: 120, height: 30 } });

  sheet.getCell('C3').value = 'Movimientos';
  sheet.getCell('C4').value = `Fecha de generación del informe: ${options.generatedOn ?? '20/10/2026'}`;

  const columns = HEADER.map((name) => ({ name })).filter(({ name }) => !(options.omitColumns ?? []).includes(name));
  columns.forEach(({ name }, i) => (sheet.getRow(5).getCell(2 + i).value = name));

  const bookingKey = (m: SampleMovement) => (m.fecha ?? m.valor).split('/').reverse().join('-');
  const booked = movements.map((m, i) => ({ m, i })).sort((a, b) => bookingKey(a.m).localeCompare(bookingKey(b.m)) || a.i - b.i);

  let cents = Math.round((options.startBalance ?? 1000) * 100);
  const rows = booked.map(({ m }) => {
    cents += Math.round(m.importe * 100);
    const disponible = m.disponible ?? cents / 100;
    const values: Record<string, string | number> = {
      'Fecha valor': m.valor,
      Fecha: m.fecha ?? m.valor,
      Concepto: m.concepto,
      Movimiento: m.movimiento ?? '',
      Importe: m.importe,
      Divisa: m.divisa ?? 'EUR',
      Disponible: disponible,
      Observaciones: '',
    };
    return values;
  });

  rows.reverse().forEach((values, r) => {
    const row = sheet.getRow(6 + r);
    columns.forEach(({ name }, i) => (row.getCell(2 + i).value = values[name]));
  });

  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
