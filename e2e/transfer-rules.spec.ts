import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

function thisMonth(day: number): string {
  const now = new Date();
  return `${String(day).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

const sheet = (page: Page) => page.getByRole('dialog');
const rules = (page: Page) => page.getByRole('list', { name: 'Reglas' }).getByRole('listitem');
const previewCategory = (page: Page, name: string) => page.locator('li', { hasText: name }).getByTestId('preview-category');
const homeAccount = (page: Page, name: string) =>
  page.getByRole('list', { name: 'Cuentas' }).getByRole('listitem').filter({ hasText: name });

const movements = [
  { valor: thisMonth(1), concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
  { valor: thisMonth(2), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -20 },
  { valor: thisMonth(3), concepto: 'Revolut**5625*', movimiento: 'Pago con tarjeta', importe: -200 },
];

test('create a transfer rule to Revolut and see the next import make the top-up a transfer', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByTestId('file-input').setInputFiles(bbvaXlsxFile(movements.slice(0, 2), { startBalance: 1000 }));
  await page.getByRole('button', { name: 'Importar 2' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Cuentas' }).click();
  await page.getByRole('button', { name: 'Nueva' }).click();
  await sheet(page).getByLabel('Nombre').fill('Revolut');
  await sheet(page).getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(sheet(page)).toHaveCount(0);

  // The rule's action is a transfer to an account instead of a category.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Reglas' }).click();
  await page.getByRole('button', { name: 'Nueva' }).click();
  await sheet(page).getByLabel('Concepto o movimiento contiene').fill('5625');
  await sheet(page).getByRole('radio', { name: 'Transferencia a cuenta' }).check();
  await expect(sheet(page).getByRole('combobox', { name: 'Categoría' })).toHaveCount(0);
  await sheet(page).getByRole('button', { name: 'Crear regla' }).click();
  await expect(sheet(page).getByRole('alert')).toHaveText('Elige una cuenta o un comercio.');
  await sheet(page).getByRole('combobox', { name: 'Cuenta' }).selectOption({ label: 'Revolut' });
  await sheet(page).getByRole('button', { name: 'Crear regla' }).click();
  await expect(sheet(page)).toHaveCount(0);

  // The list shows the account it transfers to, and the search finds the rule by it.
  await expect(rules(page).first()).toContainText('«5625»');
  await expect(rules(page).first()).toContainText('→ Revolut');
  await page.getByRole('searchbox', { name: 'Buscar reglas' }).fill('revolut');
  await expect(rules(page)).toHaveCount(1);
  await expect(rules(page)).toContainText(['«5625»']);

  // The next import's preview shows the top-up as a transfer to Revolut.
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByTestId('file-input').setInputFiles(bbvaXlsxFile(movements, { startBalance: 1000 }));
  await expect(page.getByText('1 nuevos · 2 ya importados')).toBeVisible();
  await expect(previewCategory(page, 'Revolut')).toHaveText('Transferencia → Revolut');
  await page.getByRole('button', { name: 'Importar 1' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // The 200 € reached Revolut and aren't spending.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(homeAccount(page, 'Revolut')).toContainText('200,00 €');
  await expect(page.getByTestId('month-expenses')).toHaveText('20,00 €');
});
