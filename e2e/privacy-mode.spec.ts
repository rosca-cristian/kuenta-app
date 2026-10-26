import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

/** The fixed amount every hidden amount shows, blurred: never a real one. */
const PLACEHOLDER = '0.000,00 €';
/** Any euro amount as the app writes one: "1.234,56 €", "−5,00 €", "1,2 mil €", "0 €". */
const EURO_AMOUNT = /\d[\d.,]*\s*(mil\s*|M\s*)?€/;

const sheet = (page: Page) => page.getByRole('dialog');
const eye = (page: Page) => page.getByRole('button', { name: 'Ocultar importes' });

/**
 * The screen shows blurred placeholders and no real amount anywhere: not in the text (chart
 * axes and open sheets included), not in any attribute, not in any field.
 */
async function expectMasked(page: Page) {
  await expect(page.locator('.masked-amount').first()).toBeVisible();
  const { text, attributes, filters } = await page.evaluate(() => {
    const elements = [...document.querySelectorAll('*')];
    return {
      text: document.body.textContent ?? '',
      attributes: elements
        .flatMap((element) => [...element.attributes].map((attribute) => attribute.value))
        .concat([...document.querySelectorAll('input')].map((input) => input.value)),
      filters: [...document.querySelectorAll('.masked-amount')].map((element) => getComputedStyle(element).filter),
    };
  });
  expect(text.replaceAll(PLACEHOLDER, '')).not.toMatch(EURO_AMOUNT);
  for (const value of attributes) expect(value).not.toMatch(EURO_AMOUNT);
  // Every placeholder is blurred.
  for (const filter of filters) expect(filter).toMatch(/blur\(\d/);
}

/** A chart's value axis shows only blurred placeholders. */
async function expectMaskedAxis(page: Page, chart: string) {
  const ticks = page.getByTestId(chart).locator('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value');
  await expect(ticks.first()).toHaveText(PLACEHOLDER);
  for (const tick of await ticks.all()) {
    await expect(tick).toHaveText(PLACEHOLDER);
    expect(await tick.evaluate((element) => getComputedStyle(element).filter)).toMatch(/blur\(\d/);
  }
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

  // On from Inicio: every amount is a blurred placeholder, signs dropped, that screen readers
  // hear as "Importe oculto"; percentages stay.
  await eye(page).click();
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('total-balance')).toHaveText(`${PLACEHOLDER}Importe oculto`);
  await expect(page.getByTestId('total-balance')).toMatchAriaSnapshot('- paragraph: Importe oculto');
  await expect(page.getByTestId('month-income')).toMatchAriaSnapshot('- definition: Importe oculto');
  await expect(page.getByTestId('month-income').locator('.text-income')).toBeVisible();
  await expect(page.getByTestId('month-forecast')).toMatchAriaSnapshot('- paragraph: A este ritmo gastarás Importe oculto este mes');
  await expect(page.getByTestId('goal-percent')).toHaveText('48 %');
  await expectMasked(page);

  // Movimientos: the list, the day totals, the summary and the edit sheet.
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(page.getByTestId('summary')).toHaveText(`3 movimientos · neto ${PLACEHOLDER}Importe oculto`);
  // The eye fits next to "Exportar CSV".
  await expect(page.getByRole('button', { name: 'Exportar CSV' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Movimientos' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectMasked(page);
  await page.getByRole('button', { name: /Mercadona/ }).click();
  await expect(sheet(page).locator('.masked-amount')).toHaveText(PLACEHOLDER);
  await expectMasked(page);
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);

  // Exports keep the real amounts.
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV' }).click();
  const csv = (await readFile(await (await downloading).path())).toString('utf8');
  expect(csv).toContain(';-30,00;');
  expect(csv).toContain(';1500,00;');

  // Análisis: Gastos, Mensual with its axis, Patrimonio with its axis and tooltip, and Suscripciones.
  await page.getByRole('link', { name: 'Análisis' }).click();
  await expect(page.getByTestId('spending-total').locator('.masked-amount')).toBeVisible();
  await expect(page.getByTestId('spending-percent').first()).toHaveText(/^\d+ %$/);
  await expectMasked(page);
  await page.getByRole('tab', { name: 'Mensual' }).click();
  await expectMaskedAxis(page, 'monthly-chart');
  await expectMasked(page);
  await page.getByRole('tab', { name: 'Patrimonio' }).click();
  await expect(page.getByTestId('net-worth-latest').locator('.masked-amount')).toBeVisible();
  await expectMaskedAxis(page, 'net-worth-chart');
  const chart = page.getByTestId('net-worth-chart');
  const box = (await chart.boundingBox())!;
  await chart.hover({ position: { x: box.width - 20, y: box.height / 2 } });
  const tooltipValue = chart.locator('.recharts-tooltip-item-value');
  await expect(tooltipValue).toHaveText(PLACEHOLDER);
  expect(await tooltipValue.evaluate((element) => getComputedStyle(element).filter)).toMatch(/blur\(\d/);
  await expectMasked(page);
  await page.getByRole('tab', { name: 'Suscripciones' }).click();
  await expect(page.getByTestId('subscriptions-monthly').locator('.masked-amount')).toBeVisible();
  await expect(page.getByTestId('subscriptions-spent').locator('.masked-amount')).toBeVisible();
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

  // Every edit sheet's amount starts empty instead of giving the hidden one away, and saving
  // it untouched doesn't change it. The goal's target: left empty, it keeps the stored one.
  await page.getByRole('button', { name: /Colchón/ }).click();
  await expect(sheet(page).getByLabel('Objetivo')).toHaveValue('');
  await expectMasked(page);
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByTestId('goal-percent')).toHaveText('48 %');

  // The budget's limit: saving it empty is refused.
  await openMore(page, 'Presupuestos');
  await page.getByRole('button', { name: /Supermercado/ }).click();
  await expect(sheet(page).getByLabel('Límite mensual')).toHaveValue('');
  await expectMasked(page);
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page).getByRole('alert')).toHaveText('Escribe un límite mayor que 0, por ejemplo 300 o 1.500.');
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByTestId('budget-percent')).toHaveText('60 %');

  // A non-imported account's opening balance: left empty, it keeps the stored one.
  await openMore(page, 'Cuentas');
  await page.getByRole('button', { name: 'Nueva' }).click();
  await sheet(page).getByLabel('Nombre').fill('Revolut');
  await sheet(page).getByLabel('Saldo inicial').fill('700');
  await sheet(page).getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(sheet(page)).toHaveCount(0);
  const revolut = page.getByRole('list', { name: 'Cuentas' }).getByRole('listitem').filter({ hasText: 'Revolut' }).getByRole('button');
  await revolut.click();
  await expect(sheet(page).getByLabel('Saldo inicial')).toHaveValue('');
  await expect(sheet(page).getByLabel('Saldo inicial')).toHaveAttribute('placeholder', 'Sin cambios');
  await expectMasked(page);
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page)).toHaveCount(0);

  // "Actualizar saldo": saving it empty is refused.
  await revolut.click();
  await sheet(page).getByRole('button', { name: 'Actualizar saldo' }).click();
  await expect(sheet(page).getByLabel('Saldo real')).toHaveValue('');
  await expect(sheet(page).getByText('Saldo en Kuenta de «Revolut»: ')).toMatchAriaSnapshot('- paragraph: "Saldo en Kuenta de «Revolut»: Importe oculto"');
  await expectMasked(page);
  await sheet(page).getByRole('button', { name: 'Actualizar saldo' }).click();
  await expect(sheet(page).getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);

  // Off from Movimientos: the real amounts are back, and none of the above changed.
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'true');
  await eye(page).click();
  await expect(eye(page)).toHaveAccessibleName('Ocultar importes');
  await expect(page.getByTestId('summary')).toHaveText('3 movimientos · neto +1.457,01 €');
  await expect(page.locator('.masked-amount')).toHaveCount(0);
  await expect(page.getByText('Importe oculto')).toHaveCount(0);
  await page.getByRole('link', { name: 'Inicio' }).click();
  // Revolut's 700 € included.
  await expect(page.getByTestId('total-balance')).toHaveText('3.144,02 €');
  await expect(page.getByTestId('goal-progress')).toHaveText('2.444,02 € / 5.000,00 €');
  await expect(page.getByTestId('budget-spent')).toHaveText('30,00 € / 50,00 €');
  await openMore(page, 'Cuentas');
  await revolut.click();
  await expect(sheet(page).getByLabel('Saldo inicial')).toHaveValue('700,00');
});
