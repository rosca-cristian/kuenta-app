import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
/** The last month, and its 29th (or its last day, in a shorter February): a salary paid for this month. */
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const lateDay = Math.min(29, new Date(now.getFullYear(), now.getMonth(), 0).getDate());
const lastMonthParam = `${lastMonth.getFullYear()}-${pad(lastMonth.getMonth() + 1)}`;
/** "noviembre", or "enero 2027" when the salary is from December. */
const thisMonthName = MONTHS[now.getMonth()] + (lastMonth.getFullYear() === now.getFullYear() ? '' : ` ${now.getFullYear()}`);

const sheet = (page: Page) => page.getByRole('dialog');

test('a salary paid on the 29th of last month counts in this month on Inicio, and Movimientos says so', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Más → Categorías: Nómina counts from the 25th in the next month.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Categorías' }).click();
  await page.getByRole('button', { name: 'Supermercado', exact: true }).click();
  // Only an income category has the setting.
  await expect(sheet(page).getByRole('switch', { name: 'Contar en el mes siguiente si llega tarde' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Nómina', exact: true }).click();
  const late = sheet(page).getByRole('switch', { name: 'Contar en el mes siguiente si llega tarde' });
  await expect(late).toHaveAttribute('aria-checked', 'false');
  await expect(sheet(page)).toContainText('Movimientos y los saldos siguen con la fecha del banco.');
  await late.click();
  await expect(sheet(page).getByLabel('A partir del día')).toHaveValue('25');
  await sheet(page).getByLabel('A partir del día').fill('40');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page).getByRole('alert')).toHaveText('Escribe un día del 1 al 31.');
  await sheet(page).getByLabel('A partir del día').fill('25');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Nómina', exact: true }).click();
  await expect(late).toHaveAttribute('aria-checked', 'true');
  await expect(sheet(page).getByLabel('A partir del día')).toHaveValue('25');
  await page.keyboard.press('Escape');

  // The salary of the 29th of last month and a purchase this month.
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: `${pad(lateDay)}/${pad(lastMonth.getMonth() + 1)}/${lastMonth.getFullYear()}`, concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
        { valor: `01/${pad(now.getMonth() + 1)}/${now.getFullYear()}`, concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -20 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 2' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Inicio's month is this one: the salary is its income, and the balance is the bank's.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('month-income')).toHaveText('+1.500,00 €');
  await expect(page.getByTestId('month-expenses')).toHaveText('20,00 €');
  await expect(page.getByTestId('total-balance')).toHaveText('2.480,00 €');
  await page.getByRole('button', { name: 'Mes anterior' }).click();
  await expect(page.getByTestId('month-income')).toHaveText('+0,00 €');

  // Movimientos keeps it on its date, last month, with the month it counts in.
  await page.goto(`./#/movimientos?mes=${lastMonthParam}`);
  const salary = page.getByRole('button', { name: /^Abono De Nómina/ });
  await expect(salary).toBeVisible();
  await expect(salary.getByTestId('row-counting-month')).toHaveText(`Cuenta en ${thisMonthName}`);
  await page.goto('./#/movimientos');
  await expect(page.getByRole('button', { name: /^Mercadona/ }).getByTestId('row-counting-month')).toHaveCount(0);
});
