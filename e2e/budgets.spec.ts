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

  // Más lists Presupuestos after Reglas, then Objetivos; with no budgets it explains them.
  await page.getByRole('link', { name: 'Más' }).click();
  const sections = page.getByRole('navigation', { name: 'Gestión' }).getByRole('link');
  await expect(sections).toHaveText(['Cuentas', 'Categorías', 'Comercios', 'Reglas', 'Presupuestos', 'Objetivos']);
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

/** "octubre 2026" for this month, or `offset` months from it, as the month selector shows it. */
function monthName(offset = 0): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${date.toLocaleString('es-ES', { month: 'long' })} ${date.getFullYear()}`;
}

test('change a limit "a partir de este mes" while the previous month keeps its own, filter and remove a budget', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await openBudgets(page);

  // The month selector can't go past the current month.
  await expect(page.getByText(monthName(), { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mes siguiente' })).toBeDisabled();

  // A budget added in the previous month applies from that month.
  await page.getByRole('button', { name: 'Mes anterior' }).click();
  await expect(page.getByText(monthName(-1), { exact: true })).toBeVisible();
  await expect(page.getByText('No había presupuestos este mes')).toBeVisible();
  await page.getByRole('button', { name: 'Añadir presupuesto' }).click();
  await expect(sheet(page)).toContainText(`A partir de ${monthName(-1)}`);
  await sheet(page).getByRole('button', { name: 'Restaurantes' }).click();
  await sheet(page).getByLabel('Límite mensual').fill('300');
  await sheet(page).getByRole('button', { name: 'Añadir presupuesto' }).click();
  await expect(sheet(page)).toHaveCount(0);
  const restaurantes = budgetCard(page, 'Restaurantes');
  await expect(restaurantes.getByTestId('budget-spent')).toHaveText('0,00 € / 300,00 €');
  // The "today" marker only shows in the current month.
  await expect(restaurantes.getByTestId('today-marker')).toHaveCount(0);

  // This month: 270 € at Glovo (Restaurantes, Cerca) and 80 € at Mercadona against a 50 € Supermercado budget.
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: thisMonth(1), concepto: 'Glovo', movimiento: 'Pago con tarjeta', importe: -270 },
        { valor: thisMonth(1), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -80 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 2' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');
  await openBudgets(page);
  await expect(restaurantes.getByTestId('budget-spent')).toHaveText('270,00 € / 300,00 €');
  await expect(restaurantes.getByTestId('budget-status')).toHaveText('Cerca');
  await expect(restaurantes.getByTestId('today-marker')).toBeAttached();
  await page.getByRole('button', { name: 'Añadir presupuesto' }).click();
  await sheet(page).getByRole('button', { name: 'Supermercado' }).click();
  await sheet(page).getByLabel('Límite mensual').fill('50');
  await sheet(page).getByRole('button', { name: 'Añadir presupuesto' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(budgetCard(page, 'Supermercado').getByTestId('budget-status')).toHaveText('Superado');

  // Superados shows only the budgets over; En camino every other one, Cerca included.
  const cards = page.getByRole('list', { name: 'Presupuestos' }).getByRole('listitem');
  await page.getByRole('radio', { name: 'Superados' }).check();
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Supermercado');
  await page.getByRole('radio', { name: 'En camino' }).check();
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Restaurantes');
  await page.getByRole('radio', { name: 'Todos' }).check();
  await expect(cards).toHaveCount(2);

  // Tapping a card edits its limit from this month on.
  await restaurantes.getByRole('button').click();
  await expect(page.getByRole('dialog', { name: `A partir de ${monthName()}` })).toBeVisible();
  await expect(sheet(page).getByLabel('Límite mensual')).toHaveValue('300,00');
  await sheet(page).getByLabel('Límite mensual').fill('250');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(restaurantes.getByTestId('budget-spent')).toHaveText('270,00 € / 250,00 €');
  await expect(restaurantes.getByTestId('budget-status')).toHaveText('Superado');

  // The previous month keeps its old limit, and Supermercado (added this month) had no budget then.
  await page.getByRole('button', { name: 'Mes anterior' }).click();
  await expect(page.getByText(monthName(-1), { exact: true })).toBeVisible();
  await expect(restaurantes.getByTestId('budget-spent')).toHaveText('0,00 € / 300,00 €');
  await expect(budgetCard(page, 'Supermercado')).toHaveCount(0);

  // "Quitar presupuesto" this month: Supermercado is offered again in "Añadir presupuesto".
  await page.getByRole('button', { name: 'Mes siguiente' }).click();
  await budgetCard(page, 'Supermercado').getByRole('button').click();
  await sheet(page).getByRole('button', { name: 'Quitar presupuesto' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(budgetCard(page, 'Supermercado')).toHaveCount(0);
  await expect(page.getByTestId('budgets-budgeted')).toHaveText('250,00 €');
  await page.getByRole('button', { name: 'Añadir presupuesto' }).click();
  await expect(sheet(page).getByRole('button', { name: 'Supermercado' })).toBeVisible();
});

test('Inicio warns about budgets an import exceeds and opens them; deleting a category takes its budget', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await openBudgets(page);
  for (const name of ['Restaurantes', 'Supermercado']) {
    await page.getByRole('button', { name: 'Añadir presupuesto' }).click();
    await sheet(page).getByRole('button', { name }).click();
    await sheet(page).getByLabel('Límite mensual').fill('50');
    await sheet(page).getByRole('button', { name: 'Añadir presupuesto' }).click();
    await expect(sheet(page)).toHaveCount(0);
  }

  // Nothing is over yet.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('total-balance')).toBeVisible();
  await expect(page.getByText(/superado/)).toHaveCount(0);

  // 60 € at Glovo (Restaurantes) and 80 € at Mercadona (Supermercado): both over their 50 €.
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: thisMonth(1), concepto: 'Glovo', movimiento: 'Pago con tarjeta', importe: -60 },
        { valor: thisMonth(1), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -80 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 2' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Tapping the alert opens Presupuestos showing the budgets over.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await page.getByRole('button', { name: '2 presupuestos superados' }).click();
  await expect(page.getByRole('heading', { name: 'Presupuestos' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Superados' })).toBeChecked();
  await expect(page.getByRole('list', { name: 'Presupuestos' }).getByRole('listitem')).toHaveCount(2);

  // Deleting Restaurantes says its budget goes too; one budget over is left.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Categorías' }).click();
  await page.getByRole('button', { name: 'Restaurantes', exact: true }).click();
  await sheet(page).getByRole('button', { name: 'Borrar categoría' }).click();
  await expect(sheet(page)).toContainText('También se borrará su presupuesto');
  await sheet(page).getByRole('button', { name: 'Borrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restaurantes', exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByRole('button', { name: '1 presupuesto superado' })).toBeVisible();
  await openBudgets(page);
  await expect(page.getByRole('radio', { name: 'Todos' })).toBeChecked();
  await expect(budgetCard(page, 'Restaurantes')).toHaveCount(0);
  await expect(budgetCard(page, 'Supermercado').getByTestId('budget-status')).toHaveText('Superado');
});
