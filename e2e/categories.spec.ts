import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

function thisMonth(day: number): string {
  const now = new Date();
  return `${String(day).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

const expenses = (page: Page) => page.getByRole('list', { name: 'Gastos' }).getByRole('listitem');
const sheet = (page: Page) => page.getByRole('dialog');

test('create, edit, reorder and delete categories from Más → Categorías', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile([
      { valor: thisMonth(1), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -42.1 },
      { valor: thisMonth(2), concepto: 'Lidl', movimiento: 'Pago con tarjeta', importe: -20 },
      { valor: thisMonth(3), concepto: 'Fruteria pepa', movimiento: 'Pago con tarjeta', importe: -8.4 },
    ]),
  );
  await page.getByRole('button', { name: 'Importar 3' }).click();
  await expect(page.getByTestId('import-created')).toHaveText('3 movimientos creados');

  // Más → Categorías lists the categories by kind, in order.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Categorías' }).click();
  await expect(page.getByRole('heading', { name: 'Categorías' })).toBeVisible();
  await expect(expenses(page).first()).toHaveText('Supermercado');
  await expect(expenses(page).last()).toHaveText('Otros gastos');
  await expect(page.getByRole('list', { name: 'Ingresos' }).getByRole('listitem')).toHaveText([
    'Nómina',
    'Reembolsos',
    'Intereses',
    'Prestaciones',
    'Otros ingresos',
  ]);

  // Create one with a name, kind, icon and colour.
  await page.getByRole('button', { name: 'Nueva' }).click();
  await sheet(page).getByLabel('Nombre').fill('Mascotas');
  await sheet(page).getByRole('button', { name: 'Regalo' }).click();
  await sheet(page).getByRole('button', { name: 'Verde azulado' }).click();
  await sheet(page).getByRole('button', { name: 'Crear categoría' }).click();
  await expect(expenses(page).last()).toHaveText('Mascotas');

  // A name that already exists, ignoring case and accents, is refused.
  await page.getByRole('button', { name: 'Nueva' }).click();
  await sheet(page).getByLabel('Nombre').fill('SUPERMERCADO');
  await sheet(page).getByRole('button', { name: 'Crear categoría' }).click();
  await expect(sheet(page).getByRole('alert')).toHaveText('Ya existe una categoría llamada «Supermercado».');
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);

  // Reorder and rename.
  await page.getByRole('button', { name: 'Subir Mascotas' }).click();
  await expect(expenses(page).last()).toHaveText('Otros gastos');
  await expect(expenses(page).nth(-2)).toHaveText('Mascotas');
  await page.getByRole('button', { name: 'Mascotas', exact: true }).click();
  await sheet(page).getByLabel('Nombre').fill('Animales');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(expenses(page).nth(-2)).toHaveText('Animales');

  // Deleting a used category asks where its transactions go and warns about its rules.
  await page.getByRole('button', { name: 'Supermercado', exact: true }).click();
  await sheet(page).getByRole('button', { name: 'Borrar categoría' }).click();
  await expect(sheet(page)).toContainText('«Supermercado» tiene 2 movimientos');
  await expect(sheet(page)).toContainText('Las 5 reglas que asignan esta categoría se desactivarán');
  await sheet(page).getByLabel('Mover movimientos a').selectOption({ label: 'Animales' });
  await sheet(page).getByRole('button', { name: 'Borrar', exact: true }).click();
  await expect(expenses(page).first()).toHaveText('Restaurantes');
  await expect(page.getByRole('button', { name: 'Supermercado', exact: true })).toHaveCount(0);

  // Deleting an unused category only asks for confirmation.
  await page.getByRole('button', { name: 'Viajes', exact: true }).click();
  await sheet(page).getByRole('button', { name: 'Borrar categoría' }).click();
  await expect(sheet(page)).toContainText('¿Borrar «Viajes»? No tiene movimientos.');
  await sheet(page).getByRole('button', { name: 'Borrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Viajes', exact: true })).toHaveCount(0);

  // The moved transactions show their new category, and the picker follows the new order.
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(page.getByRole('button', { name: /^Mercadona/ })).toContainText('Animales');
  await expect(page.getByRole('button', { name: /^Lidl/ })).toContainText('Animales');
  await page.getByRole('button', { name: /^Fruteria Pepa/ }).click();
  const pickerButtons = sheet(page).getByRole('group', { name: 'Categoría' }).getByRole('button');
  // The picker fills in once the categories load: wait for it before reading the order.
  await expect(pickerButtons.first()).toHaveText('Restaurantes');
  const picker = await pickerButtons.allTextContents();
  expect(picker.indexOf('Animales')).toBe(picker.indexOf('Otros gastos') - 1);
  expect(picker).not.toContain('Supermercado');
  expect(picker).not.toContain('Viajes');
});
