import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

/** "dd/mm/aaaa" for a day of this month, or of `offset` months from it. */
function dayOf(day: number, offset = 0): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offset, day);
  return `${String(day).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

const sheet = (page: Page) => page.getByRole('dialog');

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test('see net worth over the last months in Análisis → Patrimonio, a non-imported account counted', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Nothing imported yet: an empty state instead of a blank chart.
  await page.getByRole('link', { name: 'Análisis' }).click();
  await page.getByRole('tab', { name: 'Patrimonio' }).click();
  await expect(page).toHaveURL(/#\/analisis\/patrimonio$/);
  await expect(page.getByText('Sin datos de patrimonio')).toBeVisible();

  // BBVA starts at 1.000 €: −40 € last month and −60 € this month.
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: dayOf(10, -1), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -40 },
        { valor: dayOf(1), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -60 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 2' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Revolut, never imported, holds 500 €.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Cuentas' }).click();
  await page.getByRole('button', { name: 'Nueva' }).click();
  await sheet(page).getByLabel('Nombre').fill('Revolut');
  await sheet(page).getByText('Banco', { exact: true }).click();
  await sheet(page).getByLabel('Saldo inicial').fill('500');
  await sheet(page).getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(sheet(page)).toHaveCount(0);

  // Análisis comes back to Patrimonio: 900 € in BBVA plus Revolut's 500 €, 60 € less than at the end of last month.
  await page.getByRole('link', { name: 'Análisis' }).click();
  await expect(page.getByRole('tab', { name: 'Patrimonio' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('net-worth-latest')).toHaveText('1.400,00 €');
  await expect(page.getByTestId('net-worth-change')).toHaveText('−60,00 € este mes');
  await expect(page.getByTestId('net-worth-change').locator('.text-danger')).toHaveCount(1);

  // A line through one point per month, with compact euro labels, fitting the screen.
  const chart = page.getByTestId('net-worth-chart');
  await expect(chart.locator('.recharts-line-curve')).toHaveCount(1);
  await expect(chart.locator('.recharts-line-dot')).toHaveCount(2);
  const ticks = chart.locator('.recharts-cartesian-axis-tick-value');
  await expect(ticks.filter({ hasText: /^(sep|oct|nov|dic|ene|feb|mar|abr|may|jun|jul|ago)$/ })).toHaveCount(2);
  await expect(ticks.filter({ hasText: /^0 €$/ })).toHaveCount(1);
  await expect(ticks.filter({ hasText: /^1,\d mil €$/ }).first()).toBeVisible();
  expect((await chart.boundingBox())!.width).toBeLessThanOrEqual(390);
  await expectNoHorizontalScroll(page);
});
