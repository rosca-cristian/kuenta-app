import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

function thisMonth(day: number): string {
  const now = new Date();
  return `${String(day).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

const rules = (page: Page) => page.getByRole('list', { name: 'Reglas' }).getByRole('listitem');
const sheet = (page: Page) => page.getByRole('dialog');

test('create, apply, edit, reorder, disable and delete rules from Más → Reglas', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile([
      { valor: thisMonth(1), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -42.1 },
      { valor: thisMonth(2), concepto: 'Cine yelmo', movimiento: 'Pago con tarjeta', importe: -9 },
      { valor: thisMonth(3), concepto: 'Cine yelmo', movimiento: 'Pago con tarjeta', importe: -8 },
      { valor: thisMonth(4), concepto: 'Kfc', movimiento: 'Pago con tarjeta', importe: -9.5 },
    ]),
  );
  await page.getByRole('button', { name: 'Importar 4' }).click();
  await expect(page.getByTestId('import-created')).toHaveText('4 movimientos creados');

  // Más → Reglas lists the starter rules in order, with their condition and action.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Reglas' }).click();
  await expect(page.getByRole('heading', { name: 'Reglas' })).toBeVisible();
  await expect(rules(page).first()).toContainText('Concepto o movimiento contiene «mercadona»');
  await expect(rules(page).first()).toContainText('Supermercado');
  await expect(page.getByRole('switch', { name: 'Mercadona activa' })).toBeChecked();

  // A rule needs a text and an action.
  await page.getByRole('button', { name: 'Nueva' }).click();
  await sheet(page).getByRole('button', { name: 'Crear regla' }).click();
  await expect(sheet(page).getByRole('alert')).toHaveText('Escribe el texto que debe contener.');
  await sheet(page).getByLabel('Concepto o movimiento contiene').fill('cine');
  await sheet(page).getByRole('button', { name: 'Crear regla' }).click();
  await expect(sheet(page).getByRole('alert')).toHaveText('Elige una categoría o un comercio.');

  // The editor counts the matching transactions as the text changes.
  await expect(sheet(page).getByTestId('rule-matches')).toHaveText('Coincide con 2 movimientos');
  await sheet(page).getByLabel('Concepto o movimiento contiene').fill('cine yelmo x');
  await expect(sheet(page).getByTestId('rule-matches')).toHaveText('No coincide con ningún movimiento');
  await sheet(page).getByLabel('Concepto o movimiento contiene').fill('Cine');
  await expect(sheet(page).getByTestId('rule-matches')).toHaveText('Coincide con 2 movimientos');

  // Advanced options change the condition and the count.
  await sheet(page).getByText('Opciones avanzadas').click();
  await sheet(page).getByRole('radio', { name: 'Abonos' }).check();
  await expect(sheet(page).getByTestId('rule-matches')).toHaveText('No coincide con ningún movimiento');
  await sheet(page).getByRole('radio', { name: 'Cargos' }).check();
  await expect(sheet(page).getByTestId('rule-matches')).toHaveText('Coincide con 2 movimientos');

  await sheet(page).getByLabel('Categoría').selectOption({ label: 'Ocio' });
  await sheet(page).getByRole('button', { name: 'Crear regla' }).click();

  // Saving offers to apply it to the transactions already imported, and says how many changed.
  await sheet(page).getByRole('button', { name: 'Aplicar también a 2 movimientos' }).click();
  await expect(sheet(page).getByRole('status')).toHaveText('Regla aplicada: 2 movimientos cambiados.');
  await sheet(page).getByRole('button', { name: 'Hecho' }).click();
  await expect(sheet(page)).toHaveCount(0);

  // The new rule goes before every starter rule.
  await expect(rules(page).first()).toContainText('Concepto o movimiento contiene «Cine» · solo cargos');
  await expect(rules(page).first()).toContainText('Ocio');
  await expect(rules(page).nth(1)).toContainText('«mercadona»');

  // Move it down, and disable a starter rule.
  await page.getByRole('button', { name: 'Bajar Cine' }).click();
  await expect(rules(page).first()).toContainText('«mercadona»');
  await expect(rules(page).nth(1)).toContainText('«Cine»');
  await page.getByRole('switch', { name: 'Mercadona activa' }).click();
  await expect(page.getByRole('switch', { name: 'Mercadona activa' })).not.toBeChecked();

  // Edit it: set a payee name too.
  await page.getByRole('button', { name: /«Cine»/ }).click();
  await sheet(page).getByLabel('Nombre del comercio').fill('Yelmo');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await sheet(page).getByRole('button', { name: 'Aplicar también a 2 movimientos' }).click();
  await expect(sheet(page).getByRole('status')).toHaveText('Regla aplicada: 2 movimientos cambiados.');
  await sheet(page).getByRole('button', { name: 'Hecho' }).click();
  await expect(rules(page).nth(1)).toContainText('Comercio «Yelmo»');

  // Deleting it explains that the transactions keep their category.
  await page.getByRole('button', { name: /«Cine»/ }).click();
  await sheet(page).getByRole('button', { name: 'Borrar regla' }).click();
  await expect(sheet(page)).toContainText('Los movimientos que ya categorizó conservan su categoría.');
  await sheet(page).getByRole('button', { name: 'Borrar', exact: true }).click();
  await expect(page.getByRole('button', { name: /«Cine»/ })).toHaveCount(0);

  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(page.getByRole('button', { name: /^Yelmo/ })).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^Yelmo/ }).first()).toContainText('Ocio');
});
