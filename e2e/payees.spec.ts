import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

function thisMonth(day: number): string {
  const now = new Date();
  return `${String(day).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

const payees = (page: Page) => page.getByRole('list', { name: 'Comercios' }).getByRole('listitem');
const payeeRow = (page: Page, name: string) => payees(page).filter({ has: page.getByText(name, { exact: true }) });

test('rename and merge payees from Más → Comercios', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile([
      { valor: thisMonth(1), concepto: 'Www.ebay*nv14y8j34', movimiento: 'Pago con tarjeta', importe: -19.99 },
      { valor: thisMonth(2), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -42.1 },
      { valor: thisMonth(3), concepto: 'Www.ebay*nm1zi14p4', movimiento: 'Pago con tarjeta', importe: -7.5 },
      { valor: thisMonth(4), concepto: 'Ebay', movimiento: 'Pago con tarjeta', importe: -12 },
    ]),
  );
  await page.getByRole('button', { name: 'Importar 4' }).click();
  await expect(page.getByTestId('import-created')).toHaveText('4 movimientos creados');

  // Más → Comercios lists payees by name with their number of transactions.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Comercios' }).click();
  await expect(page.getByRole('heading', { name: 'Comercios' })).toBeVisible();
  await expect(payees(page)).toHaveText([
    /Ebay\s*1 movimiento/,
    /Mercadona\s*1 movimiento/,
    /Www\.ebay\*nm1zi14p4\s*1 movimiento/,
    /Www\.ebay\*nv14y8j34\s*1 movimiento/,
  ]);

  // Rename.
  await page.getByRole('button', { name: /Mercadona/ }).click();
  await page.getByLabel('Nombre').fill('Mercadona Almería');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(payeeRow(page, 'Mercadona Almería')).toBeVisible();

  // Renaming to an existing name is refused and offers merging instead.
  await page.getByRole('button', { name: /nv14y8j34/ }).click();
  await page.getByLabel('Nombre').fill('EBAY');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('alert')).toContainText('Ya existe un comercio llamado «Ebay»');
  await page.getByRole('button', { name: 'Fusionar con «Ebay»' }).click();
  await expect(payeeRow(page, 'Ebay')).toContainText('2 movimientos');
  await expect(page.getByText('Www.ebay*nv14y8j34')).toHaveCount(0);

  // Select several and merge them into one.
  await page.getByRole('button', { name: 'Seleccionar' }).click();
  await page.getByRole('checkbox', { name: /^Ebay/ }).check();
  await page.getByRole('checkbox', { name: /nm1zi14p4/ }).check();
  await page.getByRole('button', { name: 'Fusionar 2', exact: true }).click();
  await expect(page.getByRole('radio', { name: /^Ebay/ })).toBeChecked();
  await page.getByRole('button', { name: 'Fusionar 2 comercios' }).click();
  await expect(payees(page)).toHaveText([/Ebay\s*3 movimientos/, /Mercadona Almería\s*1 movimiento/]);

  // The new names show on the transactions.
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(page.getByRole('button', { name: /^Ebay/ })).toHaveCount(3);
  await expect(page.getByRole('button', { name: /^Mercadona Almería/ })).toHaveCount(1);
});
