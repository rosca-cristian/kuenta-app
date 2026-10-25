import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

const sheet = (page: Page) => page.getByRole('dialog');
const transactionRows = (page: Page) => page.locator('main').getByRole('listitem');
const chips = (page: Page) => page.getByTestId('filter-chip');

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

/** Opens "Filtros", picks an account and a type, and applies them. */
async function applyFilters(page: Page, account: string, type: string) {
  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  await sheet(page).getByRole('group', { name: 'Cuenta' }).getByRole('button', { name: account }).click();
  await sheet(page).getByRole('radio', { name: type }).check();
  await sheet(page).getByRole('button', { name: 'Aplicar' }).click();
  await expect(sheet(page)).toHaveCount(0);
}

test('filter Movimientos by account and type, with chips, a summary and "Quitar filtros"', async ({ page }) => {
  // Tuesday 20 October 2026.
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: '01/10/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
        { valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -30 },
        { valor: '05/10/2026', concepto: 'Revolut**5625*', movimiento: 'Pago con tarjeta', importe: -200 },
        { valor: '08/10/2026', concepto: 'Tienda de barrio', movimiento: 'Pago con tarjeta', importe: -15 },
        { valor: '10/10/2026', concepto: 'Bizum recibido', movimiento: 'Parte de la cena', importe: 20 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 5' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Revolut, and the top-up as a transfer to it.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Cuentas' }).click();
  await page.getByRole('button', { name: 'Nueva' }).click();
  await sheet(page).getByLabel('Nombre').fill('Revolut');
  await sheet(page).getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await page.getByRole('button', { name: /Revolut\*\*5625/ }).click();
  await sheet(page).getByRole('button', { name: 'Convertir en transferencia' }).click();
  await sheet(page).getByRole('button', { name: 'Revolut', exact: true }).click();
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page)).toHaveCount(0);

  // The whole month, summed up without the transfer.
  await expect(transactionRows(page)).toHaveCount(5);
  await expect(page.getByTestId('summary')).toHaveText('5 movimientos · neto +1.475,00 €');
  await expect(chips(page)).toHaveCount(0);

  // BBVA's expenses: a chip each, in the URL, and the summary of what's listed.
  await applyFilters(page, 'BBVA', 'Gasto');
  await expect(page).toHaveURL(/cuenta=.+&tipo=gasto/);
  await expect(chips(page)).toHaveText(['BBVA', 'Gasto']);
  await expect(transactionRows(page)).toHaveCount(2);
  await expect(page.getByTestId('summary')).toHaveText('2 movimientos · neto −45,00 €');
  await expectNoHorizontalScroll(page);

  // The edit sheet keeps them.
  await transactionRows(page).first().getByRole('button').click();
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(chips(page)).toHaveText(['BBVA', 'Gasto']);
  await expect(transactionRows(page)).toHaveCount(2);

  // Removing a chip removes only its filter; "Quitar filtros" needs two.
  await page.getByRole('button', { name: 'Quitar filtro Gasto' }).click();
  await expect(chips(page)).toHaveText(['BBVA']);
  await expect(page).not.toHaveURL(/tipo=/);
  await expect(transactionRows(page)).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Quitar filtros' })).toHaveCount(0);

  // The sheet starts from the current filters; Revolut's transfers are the top-up that reached it.
  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  await expect(sheet(page).getByRole('group', { name: 'Cuenta' }).getByRole('button', { name: 'BBVA' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet(page).getByRole('radio', { name: 'Todos' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await applyFilters(page, 'Revolut', 'Transferencia');
  await expect(chips(page)).toHaveText(['Revolut', 'Transferencia']);
  await expect(transactionRows(page)).toHaveCount(1);
  await expect(transactionRows(page)).toContainText('BBVA → Revolut');
  await expect(page.getByTestId('summary')).toHaveText('1 movimiento · neto 0,00 €');

  // "Quitar filtros" clears them all, keeping the period.
  await page.getByRole('button', { name: 'Quitar filtros' }).click();
  await expect(chips(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/cuenta=|tipo=/);
  await expect(page.getByText('octubre 2026', { exact: true })).toBeVisible();
  await expect(transactionRows(page)).toHaveCount(5);
  await expectNoHorizontalScroll(page);
});
