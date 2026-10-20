import { expect, test } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

function thisMonth(day: number): string {
  const now = new Date();
  return `${String(day).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

test('first run, weekly import, categorize and see the month', async ({ page }) => {
  const thirdParty: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol.startsWith('http')) thirdParty.push(request.url());
  });

  await page.goto('./');

  // First run.
  await page.getByRole('button', { name: 'Empezar' }).click();
  await expect(page.getByLabel('Nombre de la cuenta')).toHaveValue('BBVA');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Importar', exact: true })).toBeVisible();

  // Import a synthetic BBVA export through "Elegir archivo".
  const file = bbvaXlsxFile(
    [
      { valor: thisMonth(1), concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
      { valor: thisMonth(2), concepto: 'Bar ejemplo', movimiento: 'Pago con tarjeta', importe: -40 },
      { valor: thisMonth(2), concepto: 'Bizum', movimiento: 'Recibido: cena', importe: 15 },
    ],
    { startBalance: 1000 },
  );
  await page.getByTestId('file-input').setInputFiles(file);

  await expect(page.getByText('3 nuevos · 0 ya importados')).toBeVisible();
  await page.getByRole('button', { name: 'Importar 3' }).click();
  await expect(page.getByTestId('import-created')).toHaveText('3 movimientos creados');
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Categorize the bar expense.
  await page.getByRole('button', { name: 'Ver movimientos' }).click();
  await page.getByRole('button', { name: /Bar Ejemplo/ }).click();
  await page.getByRole('button', { name: 'Restaurantes' }).click();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('button', { name: /Bar Ejemplo.*Restaurantes/ })).toBeVisible();

  // The friend's Bizum for the dinner offers Restaurantes first.
  await page.getByRole('button', { name: /Recibido: cena/ }).click();
  await expect(page.getByRole('button', { name: 'Restaurantes' })).toBeVisible();
  const first = page.locator('fieldset button').first();
  await expect(first).toHaveText('Restaurantes');
  await page.keyboard.press('Escape');

  // Inicio shows the balance and the month.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('total-balance')).toHaveText('2.475,00 €');
  await expect(page.getByTestId('month-income')).toHaveText('+1.515,00 €');
  await expect(page.getByTestId('month-expenses')).toHaveText('40,00 €');
  await expect(page.getByText('2 movimientos sin categoría')).toBeVisible();

  // Re-importing the same file creates nothing.
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByText('0 nuevos · 3 ya importados')).toBeVisible();

  expect(thirdParty).toEqual([]);
});

test('a file that is not the BBVA export shows a clear error', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  const file = bbvaXlsxFile([{ valor: '01/10/2026', concepto: 'A', importe: -1 }], { omitColumns: ['Disponible'] });
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByRole('alert')).toHaveText('Faltan columnas en el archivo: Disponible.');
});
