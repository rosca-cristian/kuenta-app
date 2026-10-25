import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

/** "dd/mm/aaaa" for a day of this month, or of `offset` months from it. */
function dayOf(day: number, offset = 0): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offset, day);
  return `${String(day).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

/** "octubre 2026" for this month, or `offset` months from it, as the month selector shows it. */
function monthName(offset = 0): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${date.toLocaleString('es-ES', { month: 'long' })} ${date.getFullYear()}`;
}

const spendingRows = (page: Page) => page.getByRole('list', { name: 'Gastos por categoría' }).getByRole('listitem');
const transactionRows = (page: Page) => page.locator('main').getByRole('listitem');

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test('see the month’s spending by category and open its transactions in Movimientos, filtered', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Three months: Mercadona (Supermercado) and Glovo (Restaurantes) by the starter rules; the shop and the Bizum stay uncategorized.
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: dayOf(10, -2), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -40 },
        { valor: dayOf(12, -1), concepto: 'Glovo', movimiento: 'Pago con tarjeta', importe: -30 },
        { valor: dayOf(1), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -80 },
        { valor: dayOf(1), concepto: 'Glovo', movimiento: 'Pago con tarjeta', importe: -35 },
        { valor: dayOf(1), concepto: 'Tienda de barrio', movimiento: 'Pago con tarjeta', importe: -25 },
        { valor: dayOf(1), concepto: 'Bizum recibido', movimiento: 'Bizum', importe: 15 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 6' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Análisis opens on Gastos, with the tab in the URL; the other tabs are still to come.
  await page.getByRole('link', { name: 'Análisis' }).click();
  await expect(page).toHaveURL(/#\/analisis\/gastos$/);
  await expect(page.getByRole('tab', { name: 'Gastos' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Mensual' }).click();
  await expect(page.getByText('Próximamente')).toBeVisible();
  await page.getByRole('tab', { name: 'Gastos' }).click();

  // The donut with the total in its centre, and the list highest first: the uncategorized Bizum doesn't count.
  await expect(page.getByText(monthName(), { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mes siguiente' })).toBeDisabled();
  await expect(page.getByTestId('spending-donut').locator('.recharts-pie-sector')).toHaveCount(3);
  await expect(page.getByTestId('spending-total')).toHaveText('140,00 €');
  await expect(spendingRows(page)).toHaveText([/^Supermercado57 %80,00 €$/, /^Restaurantes25 %35,00 €$/, /^Sin categoría18 %25,00 €$/]);
  await expectNoHorizontalScroll(page);

  // Tapping a category opens Movimientos with that month and category, as a removable chip.
  await spendingRows(page).filter({ hasText: 'Restaurantes' }).getByRole('button').click();
  await expect(page.getByRole('heading', { name: 'Movimientos' })).toBeVisible();
  await expect(page.getByTestId('filter-chip')).toHaveText('Restaurantes');
  await expect(transactionRows(page)).toHaveCount(1);
  await expect(transactionRows(page)).toContainText('Glovo');
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Quitar filtro Restaurantes' }).click();
  await expect(page.getByTestId('filter-chip')).toHaveCount(0);
  await expect(transactionRows(page)).toHaveCount(4);

  // Back on Gastos, the previous month: tapping its only slice opens that month's Restaurantes.
  await page.getByRole('link', { name: 'Análisis' }).click();
  await page.getByRole('button', { name: 'Mes anterior' }).click();
  await expect(page.getByText(monthName(-1), { exact: true })).toBeVisible();
  await expect(page.getByTestId('spending-total')).toHaveText('30,00 €');
  await expect(spendingRows(page)).toHaveText([/^Restaurantes100 %30,00 €$/]);
  const slice = page.getByTestId('spending-donut').locator('.recharts-pie-sector path');
  const box = (await slice.boundingBox())!;
  // On the ring, not in its hole.
  await slice.click({ position: { x: box.width / 2, y: 6 } });
  await expect(page.getByTestId('filter-chip')).toHaveText('Restaurantes');
  await expect(page.getByText(monthName(-1), { exact: true })).toBeVisible();
  await expect(transactionRows(page)).toHaveCount(1);

  // Going back returns to Gastos on the same month.
  await page.goBack();
  await expect(page.getByText(monthName(-1), { exact: true })).toBeVisible();
  await expect(page.getByTestId('spending-total')).toHaveText('30,00 €');

  // Three months back there's nothing.
  await page.getByRole('button', { name: 'Mes anterior' }).click();
  await page.getByRole('button', { name: 'Mes anterior' }).click();
  await expect(page.getByText(`Sin gastos en ${monthName(-3)}`)).toBeVisible();

  // Inicio's alert opens the uncategorized transactions of the month it shows.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await page.getByRole('button', { name: '2 movimientos sin categoría' }).click();
  await expect(page.getByRole('heading', { name: 'Movimientos' })).toBeVisible();
  await expect(page.getByTestId('filter-chip')).toHaveText('Sin categoría');
  await expect(page.getByText(monthName(), { exact: true })).toBeVisible();
  await expect(transactionRows(page)).toHaveCount(2);
  await expect(transactionRows(page).filter({ hasText: 'Tienda de barrio' })).toHaveCount(1);
});
