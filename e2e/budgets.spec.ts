import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

function thisMonth(day: number): string {
  const now = new Date();
  return `${String(day).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

const sheet = (page: Page) => page.getByRole('dialog');
const budgetCard = (page: Page, name: string) =>
  page.getByRole('list', { name: 'Presupuestos' }).getByRole('listitem').filter({ hasText: name });

async function openBudgets(page: Page) {
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Presupuestos' }).click();
  await expect(page.getByRole('heading', { name: 'Presupuestos' })).toBeVisible();
}

test('add a Restaurantes budget, import more than it allows and see it Superado with the totals', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Más lists Presupuestos after Reglas; with no budgets it explains them.
  await page.getByRole('link', { name: 'Más' }).click();
  const sections = page.getByRole('navigation', { name: 'Gestión' }).getByRole('link');
  await expect(sections).toHaveText(['Cuentas', 'Categorías', 'Comercios', 'Reglas', 'Presupuestos']);
  await openBudgets(page);
  await expect(page.getByText('Aún no hay presupuestos')).toBeVisible();

  // The add sheet offers expense categories only, and asks for a category and a limit above 0.
  await page.getByRole('button', { name: 'Añadir presupuesto' }).click();
  await expect(sheet(page).getByRole('button', { name: 'Restaurantes' })).toBeVisible();
  await expect(sheet(page).getByRole('button', { name: 'Nómina' })).toHaveCount(0);
  await expect(sheet(page)).toContainText('A partir de');
  await sheet(page).getByLabel('Límite mensual').fill('50');
  await sheet(page).getByRole('button', { name: 'Añadir presupuesto' }).click();
  await expect(sheet(page).getByRole('alert')).toHaveText('Elige una categoría.');
  await sheet(page).getByRole('button', { name: 'Restaurantes' }).click();
  await sheet(page).getByLabel('Límite mensual').fill('0');
  await sheet(page).getByRole('button', { name: 'Añadir presupuesto' }).click();
  await expect(sheet(page).getByRole('alert')).toContainText('mayor que 0');
  await sheet(page).getByLabel('Límite mensual').fill('50');
  await sheet(page).getByRole('button', { name: 'Añadir presupuesto' }).click();
  await expect(sheet(page)).toHaveCount(0);

  const restaurantes = budgetCard(page, 'Restaurantes');
  await expect(restaurantes.getByTestId('budget-spent')).toHaveText('0,00 € / 50,00 €');
  await expect(restaurantes.getByTestId('budget-percent')).toHaveText('0 %');
  await expect(restaurantes.getByTestId('budget-status')).toHaveText('En camino');
  await expect(restaurantes.getByTestId('today-marker')).toBeAttached();

  // Import two Glovo orders (Restaurantes by the starter rules) worth more than the limit.
  await page.getByRole('link', { name: 'Importar' }).click();
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

  await openBudgets(page);
  await expect(restaurantes.getByTestId('budget-spent')).toHaveText('60,00 € / 50,00 €');
  await expect(restaurantes.getByTestId('budget-percent')).toHaveText('120 %');
  await expect(restaurantes.getByTestId('budget-status')).toHaveText('Superado');
  // Supermercado has no budget, so its 80 € count nowhere.
  await expect(page.getByTestId('budgets-budgeted')).toHaveText('50,00 €');
  await expect(page.getByTestId('budgets-spent')).toHaveText('60,00 €');
  await expect(page.getByTestId('budgets-remaining')).toHaveText('10,00 € por encima');

  // A second budget, typed with a thousands dot; Restaurantes is no longer offered.
  await page.getByRole('button', { name: 'Añadir presupuesto' }).click();
  await expect(sheet(page).getByRole('button', { name: 'Restaurantes' })).toHaveCount(0);
  await sheet(page).getByRole('button', { name: 'Supermercado' }).click();
  await sheet(page).getByLabel('Límite mensual').fill('1.500');
  await sheet(page).getByRole('button', { name: 'Añadir presupuesto' }).click();
  await expect(sheet(page)).toHaveCount(0);

  await expect(budgetCard(page, 'Supermercado').getByTestId('budget-spent')).toHaveText('80,00 € / 1.500,00 €');
  await expect(budgetCard(page, 'Supermercado').getByTestId('budget-status')).toHaveText('En camino');
  await expect(page.getByTestId('budgets-budgeted')).toHaveText('1.550,00 €');
  await expect(page.getByTestId('budgets-spent')).toHaveText('140,00 €');
  await expect(page.getByTestId('budgets-remaining')).toHaveText('1.410,00 €');
});
