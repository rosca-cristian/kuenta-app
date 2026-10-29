import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

const sheet = (page: Page) => page.getByRole('dialog');
const savingsCard = (page: Page) => page.getByRole('button', { name: /^(septiembre|octubre) 2026/ });
const historyRow = (page: Page, month: string) => page.getByRole('list', { name: 'Historial' }).getByRole('listitem').filter({ hasText: month });

async function openGoals(page: Page) {
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Objetivos' }).click();
  await expect(page.getByRole('heading', { name: 'Objetivos' })).toBeVisible();
}

test('set 300 € a month, follow it through the month, change it next month and keep the old one in the history', async ({ page }) => {
  // Thursday 17 September 2026: August and September are imported.
  await page.clock.setFixedTime(new Date('2026-09-17T12:00:00'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: '01/08/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
        { valor: '05/08/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -100 },
        { valor: '01/09/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
        { valor: '10/09/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -1320 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 4' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // "Ahorro mensual" comes first, explaining itself, then the goals as "Metas de ahorro".
  await openGoals(page);
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Ahorro mensual', 'Metas de ahorro']);
  await expect(page.getByText('Elige cuánto quieres ahorrar cada mes y Kuenta te dirá si lo vas consiguiendo.')).toBeVisible();
  await expect(page.getByText('Aún no hay metas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nueva meta' })).toBeVisible();

  // A target above 0 is asked for.
  await page.getByRole('button', { name: 'Elegir ahorro mensual' }).click();
  await expect(sheet(page).getByRole('heading', { name: 'Ahorro mensual' })).toBeVisible();
  await expect(sheet(page).getByRole('button', { name: 'Quitar ahorro mensual' })).toHaveCount(0);
  await sheet(page).getByLabel('Ahorrar al mes').fill('0');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page).getByRole('alert')).toHaveText('Escribe un ahorro mayor que 0, por ejemplo 300 o 1.500.');
  await sheet(page).getByLabel('Ahorrar al mes').fill('300');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page)).toHaveCount(0);

  // September: 1.500 € in, 1.320 € out. August had no target, so only September is in the history.
  await expect(page.getByTestId('savings-progress')).toHaveText('Llevas 180,00 € de 300,00 €');
  await expect(page.getByTestId('savings-percent')).toHaveText('60 %');
  await expect(page.getByTestId('savings-status')).toHaveText('Te faltan 120,00 €');
  await expect(savingsCard(page).getByTestId('today-marker')).toBeAttached();
  await expect(page.getByRole('list', { name: 'Historial' }).getByRole('listitem')).toHaveCount(1);
  await expect(historyRow(page, 'septiembre 2026').getByTestId('savings-mark')).toHaveText('en curso');
  await expect(page.getByTestId('savings-streak')).toHaveCount(0);

  // A Bizum later in the month takes it past the target.
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile([{ valor: '16/09/2026', concepto: 'Bizum', movimiento: 'Recibido: entradas', importe: 200 }], { startBalance: 2580 }),
  );
  await page.getByRole('button', { name: 'Importar 1' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');
  await openGoals(page);
  await expect(page.getByTestId('savings-progress')).toHaveText('Llevas 380,00 € de 300,00 €');
  await expect(page.getByTestId('savings-status')).toHaveText('Conseguido');

  // Thursday 8 October: a new month with nothing saved yet, and September met.
  await page.clock.setFixedTime(new Date('2026-10-08T12:00:00'));
  await page.reload();
  await expect(page.getByTestId('savings-progress')).toHaveText('Llevas 0,00 € de 300,00 €');
  await expect(page.getByTestId('savings-status')).toHaveText('Te faltan 300,00 €');
  await expect(historyRow(page, 'octubre 2026').getByTestId('savings-mark')).toHaveText('en curso');
  await expect(historyRow(page, 'septiembre 2026').getByTestId('savings-month')).toHaveText('380,00 € / 300,00 €');
  await expect(historyRow(page, 'septiembre 2026').getByTestId('savings-mark')).toHaveText('✓');
  await expect(page.getByTestId('savings-streak')).toHaveText('1 mes seguido');

  // Raised to 500 € from October: September keeps its 300 € and stays met.
  await savingsCard(page).click();
  await expect(sheet(page).getByLabel('Ahorrar al mes')).toHaveValue('300,00');
  await expect(sheet(page)).toContainText('Se aplica todos los meses desde este');
  await sheet(page).getByLabel('Ahorrar al mes').fill('500');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByTestId('savings-progress')).toHaveText('Llevas 0,00 € de 500,00 €');
  await expect(historyRow(page, 'octubre 2026').getByTestId('savings-month')).toHaveText('0,00 € / 500,00 €');
  await expect(historyRow(page, 'septiembre 2026').getByTestId('savings-month')).toHaveText('380,00 € / 300,00 €');
  await expect(historyRow(page, 'septiembre 2026').getByTestId('savings-mark')).toHaveText('✓');

  // Privacy mode blurs every amount, keeps the percentage, and the sheet's amount starts empty.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await page.getByRole('button', { name: 'Ocultar importes' }).click();
  await openGoals(page);
  await expect(page.getByTestId('savings-percent')).toHaveText('0 %');
  await expect(page.getByTestId('savings-progress').locator('.masked-amount')).toHaveCount(2);
  await expect(page.getByTestId('savings-status').locator('.masked-amount')).toHaveCount(1);
  await expect(historyRow(page, 'septiembre 2026').getByTestId('savings-month').locator('.masked-amount')).toHaveCount(2);
  for (const real of ['500,00', '380,00', '300,00']) await expect(page.locator('body')).not.toContainText(real);
  await savingsCard(page).click();
  await expect(sheet(page).getByLabel('Ahorrar al mes')).toHaveValue('');
  await sheet(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(sheet(page).getByRole('alert')).toHaveText('Escribe un ahorro mayor que 0, por ejemplo 300 o 1.500.');

  // Removed from October on, the section explains itself again.
  await sheet(page).getByRole('button', { name: 'Quitar ahorro mensual' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Elegir ahorro mensual' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Historial' })).toHaveCount(0);
});
