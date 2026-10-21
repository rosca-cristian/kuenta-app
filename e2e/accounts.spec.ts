import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

function thisMonth(day: number): string {
  const now = new Date();
  return `${String(day).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

const sheet = (page: Page) => page.getByRole('dialog');
const accountRow = (page: Page, name: string) =>
  page.getByRole('list', { name: 'Cuentas' }).getByRole('listitem').filter({ hasText: name });

test('create Revolut in Más → Cuentas, edit it and see it on Inicio', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile([{ valor: thisMonth(1), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -42.1 }], { startBalance: 1000 }),
  );
  await page.getByRole('button', { name: 'Importar 1' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Más → Cuentas lists the import account with its balance.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Cuentas' }).click();
  await expect(page.getByRole('heading', { name: 'Cuentas' })).toBeVisible();
  await expect(accountRow(page, 'BBVA')).toContainText('957,90 €');

  // Create Revolut with an opening balance of 500 €.
  await page.getByRole('button', { name: 'Nueva' }).click();
  await sheet(page).getByLabel('Nombre').fill('Revolut');
  await sheet(page).getByText('Banco', { exact: true }).click();
  await sheet(page).getByLabel('Saldo inicial').fill('500');
  await sheet(page).getByRole('button', { name: 'Billete' }).click();
  await sheet(page).getByRole('button', { name: 'Cian' }).click();
  await sheet(page).getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(accountRow(page, 'Revolut')).toContainText('Banco · no importada');
  await expect(accountRow(page, 'Revolut')).toContainText('500,00 €');

  // A name another account has, ignoring case and accents, is refused.
  await page.getByRole('button', { name: 'Nueva' }).click();
  await sheet(page).getByLabel('Nombre').fill('revólut');
  await sheet(page).getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(sheet(page).getByRole('alert')).toHaveText('Ya existe una cuenta llamada «Revolut».');
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);

  // Inicio lists it as "no importada", and the total balance adds it.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('total-balance')).toHaveText('1.457,90 €');
  const homeRevolut = page.getByRole('list', { name: 'Cuentas' }).getByRole('listitem').filter({ hasText: 'Revolut' });
  await expect(homeRevolut).toContainText('no importada');
  await expect(homeRevolut).toContainText('500,00 €');
  await expect(page.getByRole('list', { name: 'Cuentas' }).getByRole('listitem').filter({ hasText: 'BBVA' })).not.toContainText(
    'no importada',
  );

  // Editing its opening balance (a negative amount with a decimal comma) changes its balance.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Cuentas' }).click();
  await accountRow(page, 'Revolut').getByRole('button').click();
  await expect(sheet(page).getByLabel('Saldo inicial')).toHaveValue('500,00');
  await sheet(page).getByLabel('Saldo inicial').fill('-20,50');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(accountRow(page, 'Revolut')).toContainText('−20,50 €');

  // The import account's opening balance can't be edited.
  await accountRow(page, 'BBVA').getByRole('button').click();
  await expect(sheet(page).getByLabel('Saldo inicial')).toHaveCount(0);
  await expect(sheet(page)).toContainText('su saldo inicial sale de los Excel importados');
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('total-balance')).toHaveText('937,40 €');
});

test('"Actualizar saldo" on Revolut adds an adjustment, then archive it and try to delete it', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile([{ valor: thisMonth(1), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -42.1 }], { startBalance: 1000 }),
  );
  await page.getByRole('button', { name: 'Importar 1' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Cuentas' }).click();
  await page.getByRole('button', { name: 'Nueva' }).click();
  await sheet(page).getByLabel('Nombre').fill('Revolut');
  await sheet(page).getByLabel('Saldo inicial').fill('700');
  await sheet(page).getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(accountRow(page, 'Revolut')).toContainText('700,00 €');

  // The import account isn't offered "Actualizar saldo", archiving or deleting.
  await accountRow(page, 'BBVA').getByRole('button').click();
  await expect(sheet(page).getByRole('button', { name: 'Actualizar saldo' })).toHaveCount(0);
  await expect(sheet(page).getByRole('button', { name: 'Archivar cuenta' })).toHaveCount(0);
  await expect(sheet(page).getByRole('button', { name: 'Borrar cuenta' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);

  // Typing the real balance shows the adjustment it creates.
  await accountRow(page, 'Revolut').getByRole('button').click();
  await sheet(page).getByRole('button', { name: 'Actualizar saldo' }).click();
  await expect(sheet(page).getByLabel('Saldo real')).toHaveValue('700,00');
  await expect(sheet(page).getByTestId('balance-difference')).toHaveText('Ya coincide: no se creará ningún ajuste.');
  await sheet(page).getByLabel('Saldo real').fill('650');
  await expect(sheet(page).getByTestId('balance-difference')).toContainText('−50,00 €');
  await sheet(page).getByRole('button', { name: 'Actualizar saldo' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(accountRow(page, 'Revolut')).toContainText('650,00 €');

  // Inicio sees the new balance.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('total-balance')).toHaveText('1.607,90 €');
  const homeRevolut = page.getByRole('list', { name: 'Cuentas' }).getByRole('listitem').filter({ hasText: 'Revolut' });
  await expect(homeRevolut).toContainText('650,00 €');

  // Movimientos lists the adjustment on Revolut.
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(page.getByRole('button', { name: /Ajuste de saldo · Revolut/ })).toContainText('−50,00 €');

  // It has a transaction, so deleting it offers archiving instead; archived, it leaves Inicio's list but still counts.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Cuentas' }).click();
  await accountRow(page, 'Revolut').getByRole('button').click();
  await sheet(page).getByRole('button', { name: 'Borrar cuenta' }).click();
  await expect(sheet(page)).toContainText('tiene 1 movimiento y no se puede borrar');
  await sheet(page).getByRole('button', { name: 'Archivar', exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Archivadas' })).toContainText('Revolut');

  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('total-balance')).toHaveText('1.607,90 €');
  await expect(homeRevolut).toHaveCount(0);
});
