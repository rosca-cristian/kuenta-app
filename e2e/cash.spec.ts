import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

const sheet = (page: Page) => page.getByRole('dialog');
const row = (page: Page, text: string) => page.locator('main').getByRole('listitem').filter({ hasText: text });

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
}

async function openMovimientos(page: Page) {
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(page.getByRole('heading', { name: 'Movimientos' })).toBeVisible();
}

test('note down a cash expense from a withdrawal: it spills over two withdrawals and counts instead of them', async ({ page }) => {
  // Tuesday 20 October 2026: cash counts from 1 October.
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Two withdrawals, which the starter rules put in "Efectivo", and the groceries.
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: '02/10/2026', concepto: 'Retirada cajero', movimiento: 'Retirada en cajero', importe: -50 },
        { valor: '10/10/2026', concepto: 'Cajero Centro', movimiento: 'Retirada en cajero', importe: -30 },
        { valor: '15/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -20 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 3' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // A 100 € budget on Restaurantes.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Presupuestos' }).click();
  await page.getByRole('button', { name: 'Añadir presupuesto' }).click();
  await sheet(page).getByRole('button', { name: 'Restaurantes' }).click();
  await sheet(page).getByLabel('Límite mensual').fill('100');
  await sheet(page).getByRole('button', { name: 'Añadir presupuesto' }).click();

  // Taking cash out isn't spending: only the groceries count.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('month-expenses')).toHaveText('20,00 €');

  // From the first withdrawal's sheet, a 60 € dinner on 12 October.
  await openMovimientos(page);
  await row(page, 'Retirada cajero').click();
  await expect(sheet(page).getByTestId('cash-spread')).toHaveText('Repartido 0,00 € de 50,00 €');
  await sheet(page).getByRole('button', { name: 'Apuntar gasto en efectivo' }).click();
  await expect(sheet(page).getByRole('heading', { name: 'Gasto en efectivo' })).toBeVisible();
  await expect(sheet(page).getByRole('button', { name: 'Efectivo', exact: true })).toHaveCount(0);
  await expect(sheet(page).getByTestId('cash-date')).toHaveText('Hoy, 20/10/2026');
  await expect(sheet(page).getByRole('button', { name: 'Día siguiente' })).toBeDisabled();
  for (let day = 0; day < 8; day++) await sheet(page).getByRole('button', { name: 'Día anterior' }).click();
  await expect(sheet(page).getByTestId('cash-date')).toHaveText('12/10/2026');
  await sheet(page).getByRole('button', { name: 'Restaurantes', exact: true }).click();
  await sheet(page).getByRole('textbox', { name: 'Nota' }).fill('Cena');

  // More than the 80 € held then is refused.
  await sheet(page).getByLabel('Importe').fill('90');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page).getByRole('alert')).toHaveText('Solo tienes 80,00 € de efectivo a esa fecha');

  await sheet(page).getByLabel('Importe').fill('60');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page).getByRole('heading', { name: 'Movimiento' })).toBeVisible();
  await expect(sheet(page).getByTestId('cash-spread')).toHaveText('Repartido 50,00 € de 50,00 €');
  await expect(sheet(page).getByRole('list', { name: 'Gastos en efectivo' })).toContainText('Cena');
  await expect(sheet(page).getByRole('list', { name: 'Gastos en efectivo' })).toContainText('50,00 €');
  await sheet(page).getByRole('button', { name: 'Cerrar' }).click();

  // The rest came from the second withdrawal.
  await row(page, 'Cajero Centro').click();
  await expect(sheet(page).getByTestId('cash-spread')).toHaveText('Repartido 10,00 € de 30,00 €');
  await sheet(page).getByRole('button', { name: 'Cerrar' }).click();

  // The dinner counts on Inicio and in the budget; the withdrawals don't.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('month-expenses')).toHaveText('80,00 €');
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Presupuestos' }).click();
  const budget = page.getByRole('list', { name: 'Presupuestos' }).getByRole('listitem').filter({ hasText: 'Restaurantes' });
  await expect(budget.getByTestId('budget-spent')).toHaveText('60,00 € / 100,00 €');
});

test('the cash expense amount starts empty in privacy mode, and the spread is hidden', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile([{ valor: '02/10/2026', concepto: 'Retirada cajero', movimiento: 'Retirada en cajero', importe: -50 }], { startBalance: 1000 }),
  );
  await page.getByRole('button', { name: 'Importar 1' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  await openMovimientos(page);
  await row(page, 'Retirada cajero').click();
  await sheet(page).getByRole('button', { name: 'Apuntar gasto en efectivo' }).click();
  await sheet(page).getByLabel('Importe').fill('12,50');
  await sheet(page).getByRole('button', { name: 'Supermercado', exact: true }).click();
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page).getByTestId('cash-spread')).toHaveText('Repartido 12,50 € de 50,00 €');
  await sheet(page).getByRole('button', { name: 'Cerrar' }).click();

  await page.getByRole('button', { name: 'Ocultar importes' }).click();
  await row(page, 'Retirada cajero').click();
  await expect(sheet(page).getByTestId('cash-spread').getByTestId('hidden-amount')).toHaveCount(2);
  await sheet(page).getByRole('list', { name: 'Gastos en efectivo' }).getByRole('button').click();
  await expect(sheet(page).getByLabel('Importe')).toHaveValue('');
});

test('cash expenses in Movimientos: their rows, the filter, and editing and deleting them from their sheet', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: '02/10/2026', concepto: 'Retirada cajero', movimiento: 'Retirada en cajero', importe: -50 },
        { valor: '15/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -20 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 2' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // A 12,50 € coffee and pastries today, noted down from the withdrawal.
  await openMovimientos(page);
  await row(page, 'Retirada cajero').click();
  await sheet(page).getByRole('button', { name: 'Apuntar gasto en efectivo' }).click();
  await sheet(page).getByLabel('Importe').fill('12,50');
  await sheet(page).getByRole('button', { name: 'Restaurantes', exact: true }).click();
  await sheet(page).getByRole('textbox', { name: 'Nota' }).fill('Desayuno');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await sheet(page).getByRole('button', { name: 'Cerrar' }).click();

  // Its own row on its date, marked "Efectivo"; the day net and the summary stay the bank's.
  const cashRow = row(page, 'Desayuno');
  await expect(cashRow.getByTestId('cash-mark')).toHaveText('Efectivo');
  await expect(cashRow).toContainText('Restaurantes');
  await expect(cashRow).toContainText('−12,50 €');
  await expect(page.getByTestId('summary')).toHaveText('2 movimientos · neto −70,00 € · 1 gasto en efectivo');
  await expect(row(page, 'Retirada cajero').getByTestId('row-cash-spread')).toHaveText('Repartido 12,50 € de 50,00 €');
  await expectNoHorizontalScroll(page);

  // Found by its category name, and by "Gastos en efectivo".
  await page.getByRole('searchbox', { name: 'Buscar movimientos' }).fill('restaurantes');
  await expect(page.locator('main').getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Borrar búsqueda' }).click();
  await page.getByRole('button', { name: 'Filtros' }).click();
  await sheet(page).getByRole('radio', { name: 'Gastos en efectivo' }).check();
  await sheet(page).getByRole('button', { name: 'Aplicar' }).click();
  await expect(page).toHaveURL(/tipo=efectivo/);
  await expect(page.locator('main').getByRole('listitem')).toHaveCount(1);
  await expect(page.locator('main').getByRole('listitem')).toContainText('Desayuno');

  // Its sheet edits it, refusing more than the cash held then, and deletes it.
  await cashRow.click();
  await expect(sheet(page).getByRole('heading', { name: 'Gasto en efectivo' })).toBeVisible();
  await sheet(page).getByLabel('Importe').fill('60');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page).getByRole('alert')).toHaveText('Solo tienes 50,00 € de efectivo a esa fecha');
  await sheet(page).getByLabel('Importe').fill('15');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(cashRow).toContainText('−15,00 €');

  await page.getByRole('button', { name: 'Ocultar importes' }).click();
  await expect(cashRow.getByTestId('hidden-amount')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ocultar importes' }).click();

  await cashRow.click();
  await sheet(page).getByRole('button', { name: 'Borrar' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('main').getByRole('listitem')).toHaveCount(0);
});

test('the cash pocket: the "Efectivo" line in the total, the cash screen, and the reminder after 3 days', async ({ page }) => {
  // Sunday 4 October 2026.
  await page.clock.setFixedTime(new Date('2026-10-04T12:00:00'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: '01/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -20 },
        { valor: '02/10/2026', concepto: 'Retirada cajero', movimiento: 'Retirada en cajero', importe: -50 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 2' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // The bank holds 930 € and the wallet 50 €: both count in the total.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('total-balance')).toHaveText('980,00 €');
  await expect(page.getByTestId('cash-line-amount')).toHaveText('50,00 €');
  await expect(page.getByTestId('cash-reminder')).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // Three days after the withdrawal, Inicio reminds; "Más tarde" puts it off three days.
  await page.clock.setFixedTime(new Date('2026-10-05T09:00:00'));
  await page.reload();
  await expect(page.getByTestId('cash-reminder')).toHaveText(/Tienes 50,00 € de efectivo sin repartir/);
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Más tarde' }).click();
  await expect(page.getByTestId('cash-reminder')).toHaveCount(0);
  await page.clock.setFixedTime(new Date('2026-10-07T21:00:00'));
  await page.reload();
  await expect(page.getByTestId('total-balance')).toHaveText('980,00 €');
  await expect(page.getByTestId('cash-reminder')).toHaveCount(0);
  await page.clock.setFixedTime(new Date('2026-10-08T09:00:00'));
  await page.reload();

  // "Apuntar gastos" notes one down, and that's activity too.
  await page.getByRole('button', { name: 'Apuntar gastos' }).click();
  await expect(sheet(page).getByRole('heading', { name: 'Gasto en efectivo' })).toBeVisible();
  await sheet(page).getByLabel('Importe').fill('8');
  await sheet(page).getByRole('button', { name: 'Ocio', exact: true }).click();
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByTestId('cash-reminder')).toHaveCount(0);
  await expect(page.getByTestId('cash-line-amount')).toHaveText('42,00 €');
  await expect(page.getByTestId('total-balance')).toHaveText('972,00 €');

  // The line opens the cash screen, also reachable from Cuentas.
  await page.getByTestId('cash-line').click();
  await expect(page.getByRole('heading', { name: 'Efectivo' })).toBeVisible();
  await expect(page.getByTestId('cash-total')).toHaveText('42,00 €');
  await expect(page.getByRole('list', { name: 'Retiradas con efectivo' })).toContainText(/Retirada cajero/i);
  await expect(page.getByRole('list', { name: 'Retiradas con efectivo' })).toContainText('42,00 €');
  await expect(page.getByRole('list', { name: 'Últimos gastos en efectivo' })).toContainText('Ocio');
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Apuntar gasto en efectivo' }).click();
  await expect(sheet(page).getByRole('heading', { name: 'Gasto en efectivo' })).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Cerrar' }).click();

  await page.getByRole('link', { name: 'Volver' }).click();
  await expect(page.getByRole('heading', { name: 'Cuentas' })).toBeVisible();
  await expect(page.getByTestId('cash-line-amount')).toHaveText('42,00 €');

  await page.getByRole('link', { name: 'Inicio' }).click();
  await page.getByRole('button', { name: 'Ocultar importes' }).click();
  await expect(page.getByTestId('cash-line-amount').getByTestId('hidden-amount')).toHaveCount(1);
});

test('undoing the import of a withdrawal keeps its cash expenses "Sin efectivo", and they count again once reimported', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  const file = bbvaXlsxFile(
    [
      { valor: '02/10/2026', concepto: 'Retirada cajero', movimiento: 'Retirada en cajero', importe: -50 },
      { valor: '15/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -20 },
    ],
    { startBalance: 1000 },
  );
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByTestId('file-input').setInputFiles(file);
  await page.getByRole('button', { name: 'Importar 2' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  await openMovimientos(page);
  await row(page, 'Retirada cajero').click();
  await sheet(page).getByRole('button', { name: 'Apuntar gasto en efectivo' }).click();
  await sheet(page).getByLabel('Importe').fill('30');
  await sheet(page).getByRole('button', { name: 'Restaurantes', exact: true }).click();
  await sheet(page).getByRole('textbox', { name: 'Nota' }).fill('Cena');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page).getByTestId('cash-spread')).toHaveText('Repartido 30,00 € de 50,00 €');

  // Taking the withdrawal out of "Efectivo" warns before saving.
  await sheet(page).getByRole('button', { name: 'Efectivo', exact: true }).click();
  await expect(sheet(page).getByTestId('cash-uncovered')).toHaveText('1 gasto en efectivo se quedará sin efectivo.');
  await sheet(page).getByRole('button', { name: 'Cerrar' }).click();

  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('month-expenses')).toHaveText('50,00 €');

  // Undoing the import warns, and keeps the dinner without cash.
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
  await expect(sheet(page)).toContainText('1 gasto en efectivo se quedará sin efectivo.');
  await page.getByRole('button', { name: 'Deshacer importación' }).click();
  await openMovimientos(page);
  await expect(row(page, 'Cena').getByTestId('cash-mark')).toHaveText('Sin efectivo');
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('month-expenses')).toHaveText('0,00 €');

  // Reimported, the cash pays it again.
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByTestId('file-input').setInputFiles(file);
  await page.getByRole('button', { name: 'Importar 2' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('month-expenses')).toHaveText('50,00 €');
  await openMovimientos(page);
  await expect(row(page, 'Cena').getByTestId('cash-mark')).toHaveText('Efectivo');

  // Moving "Contar el efectivo desde" after the withdrawal warns, and it counts as spent again.
  await page.getByRole('link', { name: 'Más' }).click();
  await expect(page.getByTestId('cash-from-date')).toHaveText('01/10/2026');
  await page.getByTestId('cash-from-date').click();
  await sheet(page).getByLabel('Fecha').fill('2026-10-05');
  await expect(sheet(page)).toContainText('1 gasto en efectivo se quedará sin efectivo.');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByTestId('cash-from-date')).toHaveText('05/10/2026');
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('month-expenses')).toHaveText('70,00 €');
});
