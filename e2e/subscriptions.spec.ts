import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

const transactionRows = (page: Page) => page.locator('main').getByRole('listitem');

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test('categorize a payee’s charges as Suscripciones, see it assumed monthly then monthly with the totals and open all its charges', async ({ page }) => {
  // Tuesday 20 October 2026.
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: '15/09/2026', concepto: 'Netflix', movimiento: 'Pago con tarjeta', importe: -12.99 },
        { valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -30 },
        { valor: '15/10/2026', concepto: 'Netflix', movimiento: 'Pago con tarjeta', importe: -12.99 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 3' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Nothing is in "Suscripciones" yet.
  await page.getByRole('link', { name: 'Análisis' }).click();
  await page.getByRole('tab', { name: 'Suscripciones' }).click();
  await expect(page).toHaveURL(/#\/analisis\/suscripciones$/);
  await expect(page.getByText('Sin suscripciones')).toBeVisible();

  // October's charge by hand, without the suggested rule for now.
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await page.getByRole('button', { name: /Netflix/ }).click();
  await page.getByRole('button', { name: 'Suscripciones' }).click();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: '¿Usar siempre Suscripciones para Netflix? (1 más)' })).toBeVisible();
  await page.getByRole('button', { name: 'Ahora no' }).click();

  // A single charge: assumed monthly, and it counts in the totals; October's spending is that charge.
  await page.getByRole('link', { name: 'Análisis' }).click();
  await expect(page.getByRole('tab', { name: 'Suscripciones' })).toHaveAttribute('aria-selected', 'true');
  const rows = page.getByRole('list', { name: 'Suscripciones' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Netflix');
  await expect(rows.getByTestId('subscription-frequency')).toHaveText('Mensual (supuesta)');
  await expect(rows.getByTestId('subscription-monthly')).toHaveText('12,99 €/mes');
  await expect(rows.first()).toContainText('Último cargo 15/10/2026 · Próximo 15/11/2026');
  await expect(page.getByTestId('subscriptions-monthly')).toHaveText('12,99 €');
  await expect(page.getByTestId('subscriptions-yearly')).toHaveText('155,88 €');
  await expect(page.getByTestId('subscriptions-spent')).toHaveText('12,99 €');
  await expectNoHorizontalScroll(page);

  // September's charge by hand too: the second charge confirms it.
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await page.getByRole('button', { name: 'Mes anterior' }).click();
  await page.getByRole('button', { name: /Netflix/ }).click();
  await page.getByRole('button', { name: 'Suscripciones' }).click();
  await page.getByRole('button', { name: 'Guardar' }).click();

  // Charged in September and October: monthly, and the totals are its monthly amount. September's charge isn't this month's spending.
  await page.getByRole('link', { name: 'Análisis' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.getByTestId('subscription-frequency')).toHaveText('Mensual');
  await expect(rows.getByTestId('subscription-amount')).toHaveText('12,99 €');
  await expect(rows.getByTestId('subscription-monthly')).toHaveText('12,99 €/mes');
  await expect(rows.first()).toContainText('Último cargo 15/10/2026 · Próximo 15/11/2026');
  await expect(page.getByTestId('subscriptions-monthly')).toHaveText('12,99 €');
  await expect(page.getByTestId('subscriptions-yearly')).toHaveText('155,88 €');
  await expect(page.getByTestId('subscriptions-spent')).toHaveText('12,99 €');
  await expectNoHorizontalScroll(page);

  // Tapping it opens Movimientos with all that payee's charges, over all months.
  await rows.first().getByRole('button').click();
  await expect(page.getByRole('heading', { name: 'Movimientos' })).toBeVisible();
  await expect(page).toHaveURL(/mes=todos/);
  await expect(page.getByTestId('filter-chip')).toHaveText('Netflix');
  await expect(page.getByRole('radio', { name: 'Todos los meses' })).toBeChecked();
  await expect(transactionRows(page)).toHaveCount(2);
  await expect(transactionRows(page)).toHaveText([/Netflix/, /Netflix/]);
  await expect(page.locator('main section h2')).toHaveText([/15 de octubre/, /15 de septiembre/]);
  await expectNoHorizontalScroll(page);
});
