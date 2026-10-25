import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

/** "dd/mm/aaaa" for a day of this month, or of `offset` months from it. */
function dayOf(day: number, offset = 0): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offset, day);
  return `${String(day).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

/** "octubre 2026" for this month, or `offset` months from it, as the list shows it. */
function monthName(offset = 0): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${date.toLocaleString('es-ES', { month: 'long' })} ${date.getFullYear()}`;
}

const monthRows = (page: Page) => page.getByRole('list', { name: 'Balance por mes' }).getByRole('listitem');
const bars = (page: Page) => page.getByTestId('monthly-chart').locator('.recharts-bar-rectangle');

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test('see income and expenses by month, and switch to 12 months', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Before any import, Mensual has nothing to show.
  await page.getByRole('link', { name: 'Análisis' }).click();
  await page.getByRole('tab', { name: 'Mensual' }).click();
  await expect(page).toHaveURL(/#\/analisis\/mensual$/);
  await expect(page.getByText('Sin movimientos todavía')).toBeVisible();

  // Three months with payroll and spending; the Revolut top-up is a plain expense here.
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: dayOf(1, -2), concepto: 'Abono de nómina', movimiento: 'Nómina', importe: 1500 },
        { valor: dayOf(10, -2), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -1700 },
        { valor: dayOf(1, -1), concepto: 'Abono de nómina', movimiento: 'Nómina', importe: 1500 },
        { valor: dayOf(12, -1), concepto: 'Glovo', movimiento: 'Pago con tarjeta', importe: -400 },
        { valor: dayOf(1), concepto: 'Abono de nómina', movimiento: 'Nómina', importe: 1600 },
        { valor: dayOf(1), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -80.5 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 6' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Análisis comes back to Mensual: three months of bars, two each, and their nets newest first.
  await page.getByRole('link', { name: 'Análisis' }).click();
  await expect(page.getByRole('tab', { name: 'Mensual' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('radio', { name: '6 meses' })).toBeChecked();
  await expect(bars(page)).toHaveCount(6);
  await expect(monthRows(page)).toHaveCount(3);
  await expect(monthRows(page).nth(0)).toContainText(monthName());
  await expect(monthRows(page).nth(0)).toContainText('en curso');
  await expect(page.getByTestId('monthly-net')).toHaveText(['+1.519,50 €', '+1.100,00 €', '−200,00 €']);
  await expect(monthRows(page).nth(2)).toContainText(monthName(-2));
  await expect(monthRows(page).nth(2)).not.toContainText('en curso');
  // Compact, Spanish axis labels, each on one line.
  const yTicks = page.getByTestId('monthly-chart').locator('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value');
  await expect(yTicks.first()).toHaveText('0 €');
  await expect(yTicks.last()).toHaveText(/^\d(,\d)? mil €$/);
  await expect(yTicks.last().locator('tspan')).toHaveCount(1);
  await expectNoHorizontalScroll(page);

  // 12 meses: the data still starts two months ago, so the same three months show.
  await page.getByRole('radio', { name: '12 meses' }).check();
  await expect(page.getByRole('radio', { name: '12 meses' })).toBeChecked();
  await expect(bars(page)).toHaveCount(6);
  await expect(monthRows(page)).toHaveCount(3);
  await expectNoHorizontalScroll(page);

  // The choice stays while moving around the app.
  await page.getByRole('tab', { name: 'Gastos' }).click();
  await page.getByRole('link', { name: 'Inicio' }).click();
  await page.getByRole('link', { name: 'Análisis' }).click();
  await page.getByRole('tab', { name: 'Mensual' }).click();
  await expect(page.getByRole('radio', { name: '12 meses' })).toBeChecked();
  await expect(monthRows(page)).toHaveCount(3);
});
