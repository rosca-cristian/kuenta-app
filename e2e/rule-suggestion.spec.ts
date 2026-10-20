import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

function thisMonth(day: number): string {
  const now = new Date();
  return `${String(day).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

/** First run, then imports three purchases at a bakery no starter rule knows, and a Kfc. */
async function importBakery(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  const file = bbvaXlsxFile(
    [
      { valor: thisMonth(1), concepto: 'Panaderia pepe - centro', movimiento: 'Pago con tarjeta', importe: -2 },
      { valor: thisMonth(2), concepto: 'Panaderia pepe - centro', movimiento: 'Pago con tarjeta', importe: -3 },
      { valor: thisMonth(3), concepto: 'Panaderia pepe - centro', movimiento: 'Pago con tarjeta', importe: -4 },
      { valor: thisMonth(3), concepto: 'Kfc', movimiento: 'Pago con tarjeta', importe: -9 },
    ],
    { startBalance: 1000 },
  );
  await page.getByTestId('file-input').setInputFiles(file);
  await page.getByRole('button', { name: 'Importar 4' }).click();
  await page.getByRole('button', { name: 'Ver movimientos' }).click();
}

/** Categorizes one bakery purchase by hand in its edit sheet. */
async function categorizeOneBakery(page: Page) {
  await page.getByRole('button', { name: /Panaderia Pepe/ }).first().click();
  await page.getByRole('button', { name: 'Supermercado' }).click();
  await page.getByRole('button', { name: 'Guardar' }).click();
}

const bakeryRows = (page: Page, category: string) => page.getByRole('button', { name: new RegExp(`Panaderia Pepe.*${category}`) });

test('categorize one transaction, accept the rule suggestion and see the others categorized', async ({ page }) => {
  await importBakery(page);
  await categorizeOneBakery(page);

  await expect(page.getByRole('heading', { name: '¿Usar siempre Supermercado para Panaderia Pepe - Centro? (2 más)' })).toBeVisible();
  const text = page.getByLabel('Texto de la regla');
  await expect(text).toHaveValue('panaderia pepe');
  const count = page.getByTestId('quick-rule-count');
  await expect(count).toHaveText('Coincide con 3 movimientos. Se aplicará a 2 que no has editado.');

  // The count follows the text.
  await text.fill('panaderia pepa');
  await expect(count).toHaveText('No coincide con ningún movimiento.');
  await text.fill('panaderia');
  await expect(count).toHaveText('Coincide con 3 movimientos. Se aplicará a 2 que no has editado.');

  await page.getByRole('button', { name: 'Crear regla' }).click();
  await expect(bakeryRows(page, 'Supermercado')).toHaveCount(3);

  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByText('1 movimiento sin categoría')).toBeVisible();
});

test('dismissing the rule suggestion changes nothing else', async ({ page }) => {
  await importBakery(page);
  await categorizeOneBakery(page);

  await page.getByRole('button', { name: 'Ahora no' }).click();
  await expect(page.getByRole('heading', { name: /¿Usar siempre/ })).toHaveCount(0);
  await expect(bakeryRows(page, 'Supermercado')).toHaveCount(1);
  await expect(bakeryRows(page, 'Sin categoría')).toHaveCount(2);
});
