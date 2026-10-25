import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

const MASK = '•••• €';
/** Any euro amount as the app writes one: "1.234,56 €", "−5,00 €", "1,2 mil €", "0 €". */
const EURO_AMOUNT = /\d[\d.,]*\s*(mil\s*|M\s*)?€/;

const sheet = (page: Page) => page.getByRole('dialog');
const eye = (page: Page) => page.getByRole('button', { name: 'Ocultar importes' });

/** The screen shows the mask and no amount anywhere, chart axes and open sheets included. */
async function expectMasked(page: Page) {
  await expect(page.getByText(MASK).first()).toBeVisible();
  expect(await page.evaluate(() => document.body.textContent ?? '')).not.toMatch(EURO_AMOUNT);
}

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function openMore(page: Page, section: string) {
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: section }).click();
  await expect(page.getByRole('heading', { name: section })).toBeVisible();
}

test('hide every amount with the eye button, keep it after a reload, and show them again', async ({ page }) => {
  // Tuesday 20 October 2026.
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: '15/09/2026', concepto: 'Netflix', movimiento: 'Pago con tarjeta', importe: -12.99 },
        { valor: '01/10/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
        { valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -30 },
        { valor: '15/10/2026', concepto: 'Netflix', movimiento: 'Pago con tarjeta', importe: -12.99 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 4' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Netflix is a subscription, Supermercado has a budget and BBVA a goal.
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await page.getByRole('button', { name: /Netflix/ }).click();
  await sheet(page).getByRole('button', { name: 'Suscripciones' }).click();
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Crear regla' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await openMore(page, 'Presupuestos');
  await page.getByRole('button', { name: 'Añadir presupuesto' }).click();
  await sheet(page).getByRole('button', { name: 'Supermercado' }).click();
  await sheet(page).getByLabel('Límite mensual').fill('50');
  await sheet(page).getByRole('button', { name: 'Añadir presupuesto' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await openMore(page, 'Objetivos');
  await page.getByRole('button', { name: 'Nuevo objetivo' }).click();
  await sheet(page).getByLabel('Nombre').fill('Colchón');
  await sheet(page).getByLabel('Objetivo').fill('5.000');
  await sheet(page).getByRole('button', { name: /^BBVA/ }).click();
  await sheet(page).getByRole('button', { name: 'Crear objetivo' }).click();
  await expect(sheet(page)).toHaveCount(0);

  // Off by default: Inicio shows the amounts.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('total-balance')).toHaveText('2.444,02 €');
  await expect(eye(page)).toHaveAccessibleName('Ocultar importes');
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'false');
  const { width, height } = (await eye(page).boundingBox())!;
  expect(Math.min(width, height)).toBeGreaterThanOrEqual(44);

  // On from Inicio: every amount is the mask, signs included; percentages stay.
  await eye(page).click();
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('total-balance')).toHaveText(MASK);
  await expect(page.getByTestId('month-income')).toHaveText(MASK);
  await expect(page.getByTestId('goal-percent')).toHaveText('48 %');
  await expectMasked(page);

  // Movimientos: the list, the day totals, the summary and the edit sheet.
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(page.getByTestId('summary')).toHaveText(`3 movimientos · neto ${MASK}`);
  // The eye fits next to "Exportar CSV".
  await expect(page.getByRole('button', { name: 'Exportar CSV' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Movimientos' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectMasked(page);
  await page.getByRole('button', { name: /Mercadona/ }).click();
  await expect(sheet(page)).toContainText(MASK);
  await expectMasked(page);
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);

  // Exports keep the real amounts.
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV' }).click();
  const csv = (await readFile(await (await downloading).path())).toString('utf8');
  expect(csv).toContain(';-30,00;');
  expect(csv).toContain(';1500,00;');

  // Análisis: Gastos, Mensual with its axis, Patrimonio and Suscripciones.
  await page.getByRole('link', { name: 'Análisis' }).click();
  await expect(page.getByTestId('spending-total')).toHaveText(MASK);
  await expect(page.getByTestId('spending-percent').first()).toHaveText(/^\d+ %$/);
  await expectMasked(page);
  await page.getByRole('tab', { name: 'Mensual' }).click();
  const yTicks = page.getByTestId('monthly-chart').locator('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value');
  await expect(yTicks.first()).toHaveText(MASK);
  await expectMasked(page);
  await page.getByRole('tab', { name: 'Patrimonio' }).click();
  await expect(page.getByTestId('net-worth-latest')).toHaveText(MASK);
  await expect(page.getByTestId('net-worth-chart').locator('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value').first()).toHaveText(MASK);
  await expectMasked(page);
  await page.getByRole('tab', { name: 'Suscripciones' }).click();
  await expect(page.getByTestId('subscriptions-monthly')).toHaveText(MASK);
  await expectMasked(page);

  // Cuentas, Presupuestos and Objetivos.
  await openMore(page, 'Cuentas');
  await expectMasked(page);
  await openMore(page, 'Presupuestos');
  await expect(page.getByTestId('budget-percent')).toHaveText('60 %');
  await expectMasked(page);
  await openMore(page, 'Objetivos');
  await expect(page.getByTestId('goal-percent')).toHaveText('48 %');
  await expectMasked(page);

  // It belongs to this phone: still on after a reload, from the first frame.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Objetivos' })).toBeVisible();
  await expectMasked(page);

  // "Actualizar saldo" starts empty instead of giving the hidden balance away.
  await openMore(page, 'Cuentas');
  await page.getByRole('button', { name: 'Nueva' }).click();
  await sheet(page).getByLabel('Nombre').fill('Revolut');
  await sheet(page).getByLabel('Saldo inicial').fill('700');
  await sheet(page).getByRole('button', { name: 'Crear cuenta' }).click();
  await page.getByRole('list', { name: 'Cuentas' }).getByRole('listitem').filter({ hasText: 'Revolut' }).getByRole('button').click();
  await sheet(page).getByRole('button', { name: 'Actualizar saldo' }).click();
  await expect(sheet(page).getByLabel('Saldo real')).toHaveValue('');
  await expectMasked(page);
  await page.keyboard.press('Escape');

  // Off from Movimientos: the amounts are back.
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'true');
  await eye(page).click();
  await expect(eye(page)).toHaveAccessibleName('Ocultar importes');
  await expect(page.getByTestId('summary')).toHaveText('3 movimientos · neto +1.457,01 €');
  await expect(page.getByText(MASK)).toHaveCount(0);
  await page.getByRole('link', { name: 'Inicio' }).click();
  // Revolut's 700 € included.
  await expect(page.getByTestId('total-balance')).toHaveText('3.144,02 €');
});
