import { expect, test, type Page } from '@playwright/test';
import type { SampleMovement } from '../test/support/bbvaXlsx';
import { bbvaXlsxFile } from './support/xlsx';

const transactionRows = (page: Page) => page.locator('main').getByRole('listitem');

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

/** Starts Kuenta on Tuesday 20 October 2026 and imports `movements` into BBVA. */
async function importMovements(page: Page, movements: SampleMovement[]) {
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByTestId('file-input').setInputFiles(bbvaXlsxFile(movements, { startBalance: 5000 }));
  await page.getByRole('button', { name: `Importar ${movements.length}` }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');
}

test('search Movimientos in one month and across all months, keep it in the URL and clear it', async ({ page }) => {
  await importMovements(page, [
    { valor: '05/08/2026', concepto: 'Amazon', movimiento: 'Pago con tarjeta', importe: -25 },
    { valor: '01/09/2026', concepto: 'Abono de nómina', movimiento: 'Nómina septiembre', importe: 1500 },
    { valor: '12/09/2026', concepto: 'Amazon', movimiento: 'Pago con tarjeta', importe: -40 },
    { valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -30 },
    { valor: '10/10/2026', concepto: 'Amazon', movimiento: 'Pago con tarjeta', importe: -15 },
  ]);

  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(page.getByRole('radio', { name: 'Un mes' })).toBeChecked();
  await expect(page.getByText('octubre 2026', { exact: true })).toBeVisible();
  await expect(transactionRows(page)).toHaveCount(2);

  // The search goes into the URL as you type, without a history entry per keystroke.
  const search = page.getByRole('searchbox', { name: 'Buscar movimientos' });
  const historyLength = await page.evaluate(() => history.length);
  await search.pressSequentially('AMAZON');
  await expect(page).toHaveURL(/q=AMAZON/);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await expect(transactionRows(page)).toHaveCount(1);
  await expect(transactionRows(page)).toContainText('Amazon');

  // All months: every Amazon charge, newest first, still grouped by day.
  await page.getByRole('radio', { name: 'Todos los meses' }).check();
  await expect(page).toHaveURL(/mes=todos/);
  await expect(page.getByRole('button', { name: 'Mes anterior' })).toHaveCount(0);
  await expect(page.locator('main section h2')).toHaveText([/10 de octubre/, /12 de septiembre/, /5 de agosto/]);
  await expect(transactionRows(page)).toHaveCount(3);
  await expectNoHorizontalScroll(page);

  // Accents and case don't matter.
  await search.fill('nomina');
  await expect(transactionRows(page)).toHaveCount(1);
  await expect(transactionRows(page)).toContainText(/nómina/i);

  // The edit sheet and a reload keep the search and the period.
  await transactionRows(page).getByRole('button').click();
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('nomina');
  await expect(transactionRows(page)).toHaveCount(1);
  await page.reload();
  await expect(search).toHaveValue('nomina');
  await expect(page.getByRole('radio', { name: 'Todos los meses' })).toBeChecked();
  await expect(transactionRows(page)).toHaveCount(1);

  // Nothing matches: the empty state says how to widen the search.
  await search.fill('ikea');
  await expect(page.getByText('Ningún movimiento coincide')).toBeVisible();
  await expect(page.getByText('Prueba con otras palabras.')).toBeVisible();

  // Leaving all months lands on the current month, keeping the search.
  await page.getByRole('radio', { name: 'Un mes' }).check();
  await expect(page.getByText('octubre 2026', { exact: true })).toBeVisible();
  await expect(page.getByText('Busca en «Todos los meses» o prueba con otras palabras.')).toBeVisible();

  // Clearing the search shows the whole month again.
  await page.getByRole('button', { name: 'Borrar búsqueda' }).click();
  await expect(search).toHaveValue('');
  await expect(page).not.toHaveURL(/q=/);
  await expect(transactionRows(page)).toHaveCount(2);
  await expectNoHorizontalScroll(page);
});

test('a month with 500 transactions renders and scrolls to the end', async ({ page }) => {
  const movements: SampleMovement[] = Array.from({ length: 500 }, (_, i) => ({
    valor: `${String(1 + Math.floor(i / 25)).padStart(2, '0')}/10/2026`,
    concepto: `Tienda ${i + 1}`,
    movimiento: 'Pago con tarjeta',
    importe: -1,
  }));
  await importMovements(page, movements);

  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(transactionRows(page)).toHaveCount(500);
  await expect(page.locator('main section')).toHaveCount(20);

  // The bottom of the list: the last of 1 October's transactions.
  const last = transactionRows(page).last();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await expect(page.locator('main section h2').last()).toContainText('1 de octubre');
  await expectNoHorizontalScroll(page);
});
