import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

const HEADER = 'Fecha;Tipo;Cuenta;Cuenta destino;Categoría;Comercio;Nota;Importe;Concepto banco';

/** Taps "Exportar CSV" and returns the downloaded file's name and bytes. */
async function exportCsv(page: Page) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV' }).click();
  const download = await downloading;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

test('export what Movimientos shows as a CSV for Spanish Excel, disabled for an empty list', async ({ page }) => {
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
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 3' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Nothing in September to export.
  await page.getByRole('link', { name: 'Movimientos' }).click();
  const exportButton = page.getByRole('button', { name: 'Exportar CSV' });
  await page.getByRole('button', { name: 'Mes anterior' }).click();
  await expect(page.getByText('septiembre 2026', { exact: true })).toBeVisible();
  await expect(exportButton).toBeDisabled();
  await page.getByRole('button', { name: 'Mes siguiente' }).click();
  await expect(exportButton).toBeEnabled();

  // October: the BOM, the header and its lines oldest first, semicolons quoted, every line ending in CRLF.
  const october = await exportCsv(page);
  expect(october.name).toBe('kuenta-movimientos-2026-10-20.csv');
  expect([...october.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(october.bytes.subarray(3).toString('utf8').split('\r\n')).toEqual([
    HEADER,
    '01/10/2026;Ingreso;BBVA;;Nómina;Abono De Nómina;;1500,00;Abono de nómina',
    '02/10/2026;Gasto;BBVA;;Supermercado;"Mercadona; Valencia";;-12,50;"Mercadona; Valencia"',
    '',
  ]);

  // A search over all months exports only its matches.
  await page.getByRole('searchbox', { name: 'Buscar movimientos' }).fill('mercadona');
  await page.getByRole('radio', { name: 'Todos los meses' }).check();
  await expect(page.locator('main').getByRole('listitem')).toHaveCount(2);
  const search = await exportCsv(page);
  expect(search.bytes.subarray(3).toString('utf8').split('\r\n')).toEqual([
    HEADER,
    '15/08/2026;Gasto;BBVA;;Supermercado;Mercadona;;-30,00;Mercadona',
    '02/10/2026;Gasto;BBVA;;Supermercado;"Mercadona; Valencia";;-12,50;"Mercadona; Valencia"',
    '',
  ]);
});
