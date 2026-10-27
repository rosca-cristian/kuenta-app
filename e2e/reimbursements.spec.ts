import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

function thisMonth(day: number): string {
  const now = new Date();
  return `${String(day).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

const sheet = (page: Page) => page.getByRole('dialog');
const row = (page: Page, text: string) => page.locator('main').getByRole('listitem').filter({ hasText: text });

async function openMovimientos(page: Page) {
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(page.getByRole('heading', { name: 'Movimientos' })).toBeVisible();
}

/** Opens a Bizum's sheet from Movimientos and its "Es un reembolso". */
async function linkBizum(page: Page, note: string) {
  await openMovimientos(page);
  await row(page, note).click();
  await sheet(page).getByRole('button', { name: 'Es un reembolso' }).click();
  await expect(sheet(page).getByRole('heading', { name: '¿Qué gastos te devuelve?' })).toBeVisible();
}

async function categorize(page: Page, concept: string, category: string) {
  await row(page, concept).click();
  await sheet(page).getByRole('button', { name: category, exact: true }).click();
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page)).toHaveCount(0);
}

test('link three Bizum to a dinner and one to two purchases: your part counts on Inicio, Análisis and budgets; balances stay', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // The salary, a dinner three friends pay back, and a shop and a chemist the parents pay back.
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: thisMonth(1), concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1000 },
        { valor: thisMonth(1), concepto: 'Bar Romera', movimiento: 'Pago con tarjeta', importe: -73.5 },
        { valor: thisMonth(1), concepto: 'Bizum', movimiento: 'Recibido: cena Ana', importe: 38.05 },
        { valor: thisMonth(2), concepto: 'Bizum', movimiento: 'Recibido: cena Luis', importe: 9.85 },
        { valor: thisMonth(3), concepto: 'Bizum', movimiento: 'Recibido: cena Eva', importe: 15.65 },
        { valor: thisMonth(2), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -60 },
        { valor: thisMonth(3), concepto: 'Farmacia Sol', movimiento: 'Pago con tarjeta', importe: -25 },
        { valor: thisMonth(3), concepto: 'Bizum', movimiento: 'Recibido: compra papás', importe: 80 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 8' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  await openMovimientos(page);
  await categorize(page, 'Bar Romera', 'Restaurantes');
  await categorize(page, 'Farmacia Sol', 'Salud');

  // A 50 € budget on Restaurantes.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Presupuestos' }).click();
  await page.getByRole('button', { name: 'Añadir presupuesto' }).click();
  await sheet(page).getByRole('button', { name: 'Restaurantes' }).click();
  await sheet(page).getByLabel('Límite mensual').fill('50');
  await sheet(page).getByRole('button', { name: 'Añadir presupuesto' }).click();
  const budget = page.getByRole('list', { name: 'Presupuestos' }).getByRole('listitem').filter({ hasText: 'Restaurantes' });
  await expect(budget.getByTestId('budget-spent')).toHaveText('73,50 € / 50,00 €');

  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('total-balance')).toHaveText('1.985,05 €');
  await expect(page.getByTestId('month-income')).toHaveText('+1.143,55 €');
  await expect(page.getByTestId('month-expenses')).toHaveText('158,50 €');

  // Ana's Bizum pays back part of the dinner, the only expense up to its date.
  await linkBizum(page, 'Recibido: cena Ana');
  const expenses = sheet(page).getByRole('list', { name: 'Gastos' }).getByRole('listitem');
  await expect(expenses).toHaveCount(1);
  await expect(expenses).toContainText('Bar Romera');
  await expect(expenses).toContainText('Restaurantes');
  await expect(sheet(page).getByRole('button', { name: 'Quitar reembolso' })).toHaveCount(0);
  await sheet(page).getByRole('checkbox', { name: 'Bar Romera' }).check();
  await expect(sheet(page).getByLabel('Parte de Bar Romera')).toHaveValue('38,05');
  await expect(sheet(page).getByTestId('reimbursement-split')).toHaveText('Repartido 38,05 € · Queda como ingreso 0,00 €');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();

  // The income's sheet lists what it pays back, and opens the dinner's.
  await expect(sheet(page).getByRole('heading', { name: 'Movimiento' })).toBeVisible();
  await expect(sheet(page).getByTestId('stays-income')).toHaveText('Queda como ingreso 0,00 €');
  await sheet(page).getByRole('list', { name: 'Reembolso de' }).getByRole('button', { name: /Bar Romera/ }).click();
  await expect(sheet(page).getByTestId('your-share')).toHaveText('Pagado73,50 €Te devolvieron38,05 €Tu parte35,45 €');
  await page.keyboard.press('Escape');

  await linkBizum(page, 'Recibido: cena Luis');
  await sheet(page).getByRole('checkbox', { name: 'Bar Romera' }).check();
  await expect(sheet(page).getByLabel('Parte de Bar Romera')).toHaveValue('9,85');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await page.keyboard.press('Escape');

  // Eva's: a part over what's left of the dinner or of her Bizum is refused.
  await linkBizum(page, 'Recibido: cena Eva');
  await expect(sheet(page).getByRole('list', { name: 'Gastos' })).toContainText('queda 25,60 €');
  await sheet(page).getByRole('checkbox', { name: 'Bar Romera' }).check();
  await sheet(page).getByLabel('Parte de Bar Romera').fill('30');
  await expect(sheet(page).getByRole('alert')).toHaveText('No puede ser más de lo que queda del gasto (25,60 €)');
  await expect(sheet(page).getByRole('button', { name: 'Guardar' })).toBeDisabled();
  await sheet(page).getByLabel('Parte de Bar Romera').fill('20');
  await expect(sheet(page).getByRole('alert')).toHaveText('No puede ser más de lo que queda del ingreso (15,65 €)');
  // Emptied, it's the part the allocation gives.
  await sheet(page).getByLabel('Parte de Bar Romera').fill('');
  await expect(sheet(page).getByRole('alert')).toHaveCount(0);
  await expect(sheet(page).getByTestId('reimbursement-split')).toHaveText('Repartido 15,65 € · Queda como ingreso 0,00 €');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await sheet(page).getByRole('list', { name: 'Reembolso de' }).getByRole('button', { name: /Bar Romera/ }).click();
  await expect(sheet(page).getByTestId('your-share')).toContainText('Tu parte9,95 €');
  // The dinner's sheet lists the three Bizum, each opening its own.
  const paidBy = sheet(page).getByRole('list', { name: 'Te lo devolvieron' }).getByRole('button');
  await expect(paidBy).toHaveText([/Recibido: cena Ana.*38,05 €/, /Recibido: cena Luis.*9,85 €/, /Recibido: cena Eva.*15,65 €/]);
  await paidBy.filter({ hasText: 'Luis' }).click();
  await expect(sheet(page).getByRole('list', { name: 'Reembolso de' })).toContainText('Bar Romera');
  await page.keyboard.press('Escape');

  // The parents' Bizum pays back the shop and the chemist, oldest first.
  await linkBizum(page, 'Recibido: compra papás');
  await sheet(page).getByRole('checkbox', { name: 'Mercadona' }).check();
  await sheet(page).getByRole('checkbox', { name: 'Farmacia Sol' }).check();
  await expect(sheet(page).getByLabel('Parte de Mercadona')).toHaveValue('60,00');
  await expect(sheet(page).getByLabel('Parte de Farmacia Sol')).toHaveValue('20,00');
  await expect(sheet(page).getByTestId('reimbursement-split')).toHaveText('Repartido 80,00 € · Queda como ingreso 0,00 €');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await sheet(page).getByRole('list', { name: 'Reembolso de' }).getByRole('button', { name: /Farmacia Sol/ }).click();
  await expect(sheet(page).getByTestId('your-share')).toHaveText('Pagado25,00 €Te devolvieron20,00 €Tu parte5,00 €');
  await page.keyboard.press('Escape');

  // Movimientos keeps the bank's amounts, marks the Bizum and shows your part of each expense.
  await expect(row(page, 'Bar Romera')).toContainText('−73,50 €');
  await expect(row(page, 'Bar Romera').getByTestId('row-your-share')).toHaveText('Tu parte 9,95 €');
  await expect(row(page, 'Mercadona').getByTestId('row-your-share')).toHaveText('Tu parte 0,00 €');
  await expect(row(page, 'Recibido: cena Ana')).toContainText('+38,05 €');
  await expect(row(page, 'Recibido: cena Ana').getByTestId('reimbursement-mark')).toHaveText('Reembolso');
  await expect(row(page, 'Abono de nómina').getByTestId('reimbursement-mark')).toHaveCount(0);
  await expect(row(page, 'Abono de nómina').getByTestId('row-your-share')).toHaveCount(0);
  // The summary and the day totals stay the money that came in and went out.
  await expect(page.getByTestId('summary')).toHaveText('8 movimientos · neto +985,05 €');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  // "Reembolsos" lists the four Bizum, in the URL and as a chip.
  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  await sheet(page).getByRole('radio', { name: 'Reembolsos' }).check();
  await sheet(page).getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.locator('main').getByRole('listitem')).toHaveCount(4);
  await expect(page.getByTestId('reimbursement-mark')).toHaveCount(4);
  await expect(page.getByTestId('filter-chip')).toHaveText(['Reembolsos']);
  await expect(page.getByTestId('summary')).toHaveText('4 movimientos · neto +143,55 €');
  expect(page.url()).toContain('tipo=reembolso');
  await page.reload();
  await expect(page.locator('main').getByRole('listitem')).toHaveCount(4);
  await page.getByTestId('filter-chip').getByRole('button').click();
  await expect(page.locator('main').getByRole('listitem')).toHaveCount(8);

  // Inicio: only the salary is income, and the expenses are your parts; the balance doesn't change.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('total-balance')).toHaveText('1.985,05 €');
  await expect(page.getByTestId('month-income')).toHaveText('+1.000,00 €');
  await expect(page.getByTestId('month-expenses')).toHaveText('14,95 €');
  await expect(page.getByTestId('month-savings')).toHaveText('985,05 €');
  await expect(page.getByTestId('month-savings-rate')).toHaveText('99 %');

  // Análisis → Gastos: 9,95 € of Restaurantes and 5 € of Salud; Mercadona, paid back whole, is gone.
  await page.getByRole('link', { name: 'Análisis' }).click();
  await expect(page.getByTestId('spending-total')).toHaveText('14,95 €');
  await expect(page.getByRole('list', { name: 'Gastos por categoría' }).getByRole('listitem')).toHaveText([
    /^Restaurantes67 %9,95 €$/,
    /^Salud33 %5,00 €$/,
  ]);

  // The budget counts your part of the dinner.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Presupuestos' }).click();
  await expect(budget.getByTestId('budget-spent')).toHaveText('9,95 € / 50,00 €');

  // In privacy mode the parts start empty, and saving keeps them.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await page.getByRole('button', { name: 'Ocultar importes' }).click();
  await openMovimientos(page);
  // "Tu parte" is blurred like the amounts.
  await expect(row(page, 'Bar Romera').getByTestId('row-your-share')).toContainText('Tu parte');
  await expect(row(page, 'Bar Romera').getByTestId('row-your-share').getByTestId('hidden-amount')).toBeVisible();
  await expect(row(page, 'Bar Romera')).not.toContainText('9,95');
  await row(page, 'Recibido: compra papás').click();
  await sheet(page).getByRole('button', { name: 'Cambiar reembolso' }).click();
  await expect(sheet(page).getByLabel('Parte de Mercadona')).toHaveValue('');
  await expect(sheet(page).getByLabel('Parte de Mercadona')).toHaveAttribute('placeholder', 'Sin cambios');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page).getByRole('list', { name: 'Reembolso de' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Ocultar importes' }).click();
  await row(page, 'Farmacia Sol').click();
  await expect(sheet(page).getByTestId('your-share')).toContainText('Tu parte5,00 €');

  // "Quitar reembolso" gives the parents' Bizum back to income.
  await sheet(page).getByRole('list', { name: 'Te lo devolvieron' }).getByRole('button').click();
  await sheet(page).getByRole('button', { name: 'Cambiar reembolso' }).click();
  await sheet(page).getByRole('button', { name: 'Quitar reembolso' }).click();
  await expect(sheet(page).getByRole('button', { name: 'Es un reembolso' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('month-income')).toHaveText('+1.080,00 €');
  await expect(page.getByTestId('month-expenses')).toHaveText('94,95 €');
  await expect(page.getByTestId('total-balance')).toHaveText('1.985,05 €');
});
