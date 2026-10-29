import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

function thisMonth(day: number): string {
  const now = new Date();
  return `${String(day).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

const sheet = (page: Page) => page.getByRole('dialog');
const listItem = (page: Page, list: string, name: string) =>
  page.getByRole('list', { name: list }).getByRole('listitem').filter({ hasText: name });

async function openInicio(page: Page) {
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
}

async function addBudget(page: Page, category: string, limit: string) {
  await page.getByRole('button', { name: 'Añadir presupuesto' }).click();
  await sheet(page).getByRole('button', { name: category }).click();
  await sheet(page).getByLabel('Límite mensual').fill(limit);
  await sheet(page).getByRole('button', { name: 'Añadir presupuesto' }).click();
  await expect(sheet(page)).toHaveCount(0);
}

test('with two budgets and a goal, Inicio shows both blocks and their links open Presupuestos and Objetivos', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  // Glovo is Restaurantes and Mercadona Supermercado by the starter rules.
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: thisMonth(1), concepto: 'Glovo', movimiento: 'Pago con tarjeta', importe: -35 },
        { valor: thisMonth(1), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -80 },
        { valor: thisMonth(2), concepto: 'Glovo', movimiento: 'Pago con tarjeta', importe: -25 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 3' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Without budgets or goals, neither block shows.
  await openInicio(page);
  await expect(page.getByRole('heading', { name: 'Cuentas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Presupuestos' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Metas de ahorro' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Presupuestos' }).click();
  await addBudget(page, 'Restaurantes', '50');
  await addBudget(page, 'Supermercado', '90');

  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Objetivos' }).click();
  await page.getByRole('button', { name: 'Nueva meta' }).click();
  await sheet(page).getByLabel('Nombre').fill('Colchón');
  await sheet(page).getByLabel('Objetivo').fill('2.000');
  await sheet(page).getByRole('button', { name: /^BBVA/ }).click();
  await sheet(page).getByRole('button', { name: 'Crear meta' }).click();
  await expect(sheet(page)).toHaveCount(0);

  // Below Cuentas: the budgets by percentage used, Superado in red and Cerca in amber.
  await openInicio(page);
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Cuentas', 'Presupuestos', 'Metas de ahorro']);
  await expect(page.getByRole('list', { name: 'Presupuestos' }).getByRole('listitem')).toHaveText([/^Restaurantes/, /^Supermercado/]);
  const restaurantes = listItem(page, 'Presupuestos', 'Restaurantes');
  await expect(restaurantes.getByTestId('budget-spent')).toHaveText('60,00 € / 50,00 €');
  await expect(restaurantes.getByTestId('budget-spent')).toHaveClass(/text-danger/);
  await expect(restaurantes.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '120 % · Superado');
  const supermercado = listItem(page, 'Presupuestos', 'Supermercado');
  await expect(supermercado.getByTestId('budget-spent')).toHaveText('80,00 € / 90,00 €');
  await expect(supermercado.getByTestId('budget-spent')).toHaveClass(/text-warn/);
  await expect(supermercado.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '88 % · Cerca');

  // The goal's progress is BBVA's balance: 1.000 € − 140 €.
  const colchon = listItem(page, 'Metas de ahorro', 'Colchón');
  await expect(colchon.getByTestId('goal-progress')).toHaveText('860,00 € / 2.000,00 €');
  await expect(colchon.getByTestId('goal-percent')).toHaveText('43 %');
  await expect(colchon.getByTestId('goal-reached')).toHaveCount(0);

  // Everything fits the phone's width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.getByRole('link', { name: 'Ver todos' }).click();
  await expect(page.getByRole('heading', { name: 'Presupuestos' })).toBeVisible();
  await expect(page).toHaveURL(/\/mas\/presupuestos$/);

  await openInicio(page);
  await colchon.getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Objetivos' })).toBeVisible();
  await expect(page).toHaveURL(/\/mas\/objetivos$/);

  // Once reached, it says Conseguido instead of the percentage.
  await listItem(page, 'Metas de ahorro', 'Colchón').getByRole('button').click();
  await sheet(page).getByLabel('Objetivo').fill('500');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await openInicio(page);
  await expect(colchon.getByTestId('goal-reached')).toHaveText('Conseguido');
  await expect(colchon.getByTestId('goal-percent')).toHaveCount(0);
});
