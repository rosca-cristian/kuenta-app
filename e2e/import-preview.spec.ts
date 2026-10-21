import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

function thisMonth(day: number): string {
  const now = new Date();
  return `${String(day).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

const previewRow = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) });
const previewCategory = (page: Page, name: string) => page.locator('li', { hasText: name }).getByTestId('preview-category');

test('change categories in the preview, create a rule from a row and import', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  const file = bbvaXlsxFile(
    [
      { valor: thisMonth(1), concepto: 'Kfc 0123 gran via', movimiento: 'Pago con tarjeta', importe: -9 },
      { valor: thisMonth(2), concepto: 'Kfc 0456 sol', movimiento: 'Pago con tarjeta', importe: -12 },
      { valor: thisMonth(3), concepto: 'Kfc 0789 norte', movimiento: 'Pago con tarjeta', importe: -7 },
      { valor: thisMonth(3), concepto: 'Bar ejemplo', movimiento: 'Pago con tarjeta', importe: -40 },
      { valor: thisMonth(4), concepto: 'Bizum', movimiento: 'Recibido: cena', importe: 15 },
    ],
    { startBalance: 1000 },
  );
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByText('5 nuevos · 0 ya importados')).toBeVisible();
  await expect(previewCategory(page, 'Bar Ejemplo')).toHaveText('Sin categoría');

  // Change two rows' category by hand.
  await previewRow(page, 'Bar Ejemplo').click();
  await page.getByRole('button', { name: 'Ocio', exact: true }).click();
  await expect(previewCategory(page, 'Bar Ejemplo')).toHaveText('Ocio');
  await previewRow(page, 'Kfc 0456 Sol').click();
  await page.getByRole('button', { name: 'Regalos', exact: true }).click();
  await expect(previewCategory(page, 'Kfc 0456 Sol')).toHaveText('Regalos');

  // No rule from a Bizum: it would match every Bizum.
  await previewRow(page, 'Recibido: cena').click();
  await expect(page.getByRole('button', { name: 'Restaurantes', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear regla con este concepto' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Create a rule from another row: it applies to the rows not changed by hand.
  await previewRow(page, 'Kfc 0123 Gran Via').click();
  await page.getByRole('button', { name: 'Crear regla con este concepto' }).click();
  await expect(page.getByLabel('Texto de la regla')).toHaveValue('kfc');
  await page.getByRole('dialog').getByRole('combobox', { name: 'Categoría' }).selectOption('Restaurantes');
  await expect(page.getByTestId('quick-rule-pending')).toHaveText('En esta importación: 2 filas.');
  await page.getByRole('button', { name: 'Crear regla', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Crear regla' })).toHaveCount(0);

  await expect(previewCategory(page, 'Kfc 0123 Gran Via')).toHaveText('Restaurantes');
  await expect(previewCategory(page, 'Kfc 0789 Norte')).toHaveText('Restaurantes');
  await expect(previewCategory(page, 'Kfc 0456 Sol')).toHaveText('Regalos');
  await expect(previewCategory(page, 'Bar Ejemplo')).toHaveText('Ocio');
  await expect(previewCategory(page, 'Recibido: cena')).toHaveText('Sin categoría');

  // The import keeps the categories of the preview.
  await page.getByRole('button', { name: 'Importar 5' }).click();
  await expect(page.getByTestId('import-created')).toHaveText('5 movimientos creados');
  await page.getByRole('button', { name: 'Ver movimientos' }).click();
  await expect(page.getByRole('button', { name: /^Kfc 0123 Gran Via.*Restaurantes/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Kfc 0789 Norte.*Restaurantes/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Kfc 0456 Sol.*Regalos/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Bar Ejemplo.*Ocio/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Recibido: cena.*Sin categoría/ })).toBeVisible();
});
