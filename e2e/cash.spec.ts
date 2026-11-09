import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

const sheet = (page: Page) => page.getByRole('dialog');
const row = (page: Page, text: string) => page.locator('main').getByRole('listitem').filter({ hasText: text });

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
