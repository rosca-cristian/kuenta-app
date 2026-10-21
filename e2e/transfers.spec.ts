import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

function thisMonth(day: number): string {
  const now = new Date();
  return `${String(day).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

const sheet = (page: Page) => page.getByRole('dialog');
const homeAccount = (page: Page, name: string) =>
  page.getByRole('list', { name: 'Cuentas' }).getByRole('listitem').filter({ hasText: name });
const topUpRow = (page: Page) => page.getByRole('button', { name: /Revolut\*\*5625/ });

test('convert an imported top-up into a transfer to Revolut and back, seeing Revolut on Inicio', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: thisMonth(1), concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
        { valor: thisMonth(2), concepto: 'Revolut**5625*', movimiento: 'Pago con tarjeta', importe: -200 },
        { valor: thisMonth(2), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -20 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 3' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Create Revolut, with the default opening balance of 0.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Cuentas' }).click();
  await page.getByRole('button', { name: 'Nueva' }).click();
  await sheet(page).getByLabel('Nombre').fill('Revolut');
  await sheet(page).getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(sheet(page)).toHaveCount(0);

  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('total-balance')).toHaveText('2.280,00 €');
  await expect(page.getByTestId('month-expenses')).toHaveText('220,00 €');
  await expect(homeAccount(page, 'Revolut')).toHaveText(/[^\d.]0,00 €$/);

  // Convert the top-up: the category picker gives way to the transfer.
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await topUpRow(page).click();
  await sheet(page).getByRole('button', { name: 'Convertir en transferencia' }).click();
  await expect(sheet(page).getByRole('group', { name: '¿A qué cuenta va el dinero?' })).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Revolut', exact: true }).click();
  await expect(sheet(page)).toContainText('Transferencia a Revolut');
  await expect(sheet(page).getByRole('group', { name: 'Categoría' })).toHaveCount(0);
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page)).toHaveCount(0);

  // Movimientos shows it between the accounts, out of the day's net.
  await expect(topUpRow(page)).toContainText('BBVA → Revolut');
  await expect(topUpRow(page).getByLabel('Transferencia')).toBeVisible();
  await expect(page.locator('section', { has: topUpRow(page) }).getByRole('heading')).toContainText('−20,00 €');

  // Revolut holds the 200 €; BBVA keeps what the bank says, and they're no longer an expense.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(homeAccount(page, 'Revolut')).toContainText('200,00 €');
  await expect(homeAccount(page, 'BBVA')).toContainText('2.280,00 €');
  await expect(page.getByTestId('total-balance')).toHaveText('2.480,00 €');
  await expect(page.getByTestId('month-expenses')).toHaveText('20,00 €');

  // "Quitar transferencia" makes it an uncategorized expense again.
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await topUpRow(page).click();
  await sheet(page).getByRole('button', { name: 'Quitar transferencia' }).click();
  await expect(sheet(page).getByRole('group', { name: 'Categoría' })).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(topUpRow(page)).toContainText('Sin categoría · BBVA');

  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(homeAccount(page, 'Revolut')).toHaveText(/[^\d.]0,00 €$/);
  await expect(page.getByTestId('total-balance')).toHaveText('2.280,00 €');
});
