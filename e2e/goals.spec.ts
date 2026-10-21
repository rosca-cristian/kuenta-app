import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

function thisMonth(day: number): string {
  const now = new Date();
  return `${String(day).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

const sheet = (page: Page) => page.getByRole('dialog');
const goalCard = (page: Page, name: string) => page.getByRole('list', { name: 'Objetivos' }).getByRole('listitem').filter({ hasText: name });
const topUpRow = (page: Page) => page.getByRole('button', { name: /Revolut\*\*5625/ });

async function openGoals(page: Page) {
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Objetivos' }).click();
  await expect(page.getByRole('heading', { name: 'Objetivos' })).toBeVisible();
}

test('create a goal on Revolut and see it rise when an imported top-up becomes a transfer to Revolut', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: thisMonth(1), concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
        { valor: thisMonth(2), concepto: 'Revolut**5625*', movimiento: 'Pago con tarjeta', importe: -750 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 2' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Revolut, a non-imported account with nothing in it yet.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Cuentas' }).click();
  await page.getByRole('button', { name: 'Nueva' }).click();
  await sheet(page).getByLabel('Nombre').fill('Revolut');
  await sheet(page).getByRole('button', { name: 'Cian', exact: true }).click();
  await sheet(page).getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(sheet(page)).toHaveCount(0);

  await openGoals(page);
  await expect(page.getByText('Aún no hay objetivos')).toBeVisible();

  // The sheet asks for a name, a target above 0 and an account; icon and colour follow the account's.
  await page.getByRole('button', { name: 'Nuevo objetivo' }).click();
  await expect(sheet(page).getByRole('group', { name: 'Cuenta' }).getByRole('button')).toHaveCount(2);
  await sheet(page).getByRole('button', { name: 'Crear objetivo' }).click();
  await expect(sheet(page).getByRole('alert')).toHaveText('Escribe un nombre.');
  await sheet(page).getByLabel('Nombre').fill('Viaje Japón');
  await sheet(page).getByLabel('Objetivo').fill('0');
  await sheet(page).getByRole('button', { name: 'Crear objetivo' }).click();
  await expect(sheet(page).getByRole('alert')).toContainText('mayor que 0');
  await sheet(page).getByLabel('Objetivo').fill('3.000');
  await sheet(page).getByRole('button', { name: 'Crear objetivo' }).click();
  await expect(sheet(page).getByRole('alert')).toHaveText('Elige una cuenta.');
  await sheet(page).getByRole('button', { name: /^Revolut/ }).click();
  await expect(sheet(page).getByRole('button', { name: 'Cian', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await sheet(page).getByRole('button', { name: 'Avión' }).click();
  await sheet(page).getByRole('button', { name: 'Crear objetivo' }).click();
  await expect(sheet(page)).toHaveCount(0);

  const japan = goalCard(page, 'Viaje Japón');
  await expect(japan).toContainText('Revolut');
  await expect(japan.getByTestId('goal-progress')).toHaveText('0,00 € / 3.000,00 €');
  await expect(japan.getByTestId('goal-percent')).toHaveText('0 %');
  await expect(japan.getByTestId('goal-reached')).toHaveCount(0);

  // Revolut has its goal now, so a new one can only go on BBVA.
  await page.getByRole('button', { name: 'Nuevo objetivo' }).click();
  await expect(sheet(page).getByRole('group', { name: 'Cuenta' }).getByRole('button')).toHaveText([/^BBVA/]);
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);

  // The top-up becomes a transfer to Revolut, whose balance is the goal's progress.
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await topUpRow(page).click();
  await sheet(page).getByRole('button', { name: 'Convertir en transferencia' }).click();
  await sheet(page).getByRole('button', { name: 'Revolut', exact: true }).click();
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page)).toHaveCount(0);

  await openGoals(page);
  await expect(japan.getByTestId('goal-progress')).toHaveText('750,00 € / 3.000,00 €');
  await expect(japan.getByTestId('goal-percent')).toHaveText('25 %');
  await expect(japan.getByRole('progressbar', { name: 'Progreso de Viaje Japón' })).toHaveAttribute('aria-valuenow', '25');
});
