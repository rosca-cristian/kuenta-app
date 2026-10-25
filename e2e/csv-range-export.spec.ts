import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

const HEADER = 'Fecha;Tipo;Cuenta;Cuenta destino;Categoría;Comercio;Nota;Importe;Concepto banco';

test('export a date range as CSV from Copias de seguridad, disabled for an inverted range', async ({ page }) => {
  // Tuesday 20 October 2026.
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: '15/08/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -30 },
        { valor: '01/10/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
        { valor: '02/10/2026', concepto: 'Mercadona; Valencia', movimiento: 'Pago con tarjeta', importe: -12.5 },
        { valor: '10/10/2026', concepto: 'Farmacia', movimiento: 'Pago con tarjeta', importe: -8 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 4' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Copias de seguridad' }).click();

  // The whole history by default.
  const from = page.getByLabel('Desde');
  const to = page.getByLabel('Hasta');
  const count = page.getByTestId('csv-range-count');
  const exportButton = page.getByRole('button', { name: 'Exportar movimientos (CSV)' });
  await expect(from).toHaveValue('2026-08-15');
  await expect(to).toHaveValue('2026-10-20');
  await expect(count).toHaveText('4 movimientos');

  // Part of it: both ends included.
  await from.fill('2026-10-01');
  await to.fill('2026-10-02');
  await expect(count).toHaveText('2 movimientos');
  const downloading = page.waitForEvent('download');
  await exportButton.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('kuenta-movimientos-2026-10-20.csv');
  const bytes = await readFile(await download.path());
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(bytes.subarray(3).toString('utf8').split('\r\n')).toEqual([
    HEADER,
    '01/10/2026;Ingreso;BBVA;;Nómina;Abono De Nómina;;1500,00;Abono de nómina',
    '02/10/2026;Gasto;BBVA;;Supermercado;"Mercadona; Valencia";;-12,50;"Mercadona; Valencia"',
    '',
  ]);
  // A CSV isn't a backup.
  await expect(page.getByTestId('last-backup')).toHaveText('Última copia: Nunca');

  // Nothing in the range, then "Desde" after "Hasta".
  await from.fill('2026-09-01');
  await to.fill('2026-09-30');
  await expect(count).toHaveText('No hay movimientos entre esas fechas.');
  await expect(exportButton).toBeDisabled();
  await from.fill('2026-10-10');
  await to.fill('2026-10-01');
  await expect(count).toHaveText('«Desde» es posterior a «Hasta».');
  await expect(exportButton).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
