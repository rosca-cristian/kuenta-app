import { expect, test } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

test('on day 10 Inicio forecasts the month with the gym fee still to come, and past months show no forecast', async ({ page }) => {
  // Saturday 10 October 2026: 10 days elapsed of 31.
  await page.clock.setFixedTime(new Date('2026-10-10T12:00:00'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: '05/08/2026', concepto: 'Gimnasio Vital', movimiento: 'Pago con tarjeta', importe: -40 },
        { valor: '05/09/2026', concepto: 'Gimnasio Vital', movimiento: 'Pago con tarjeta', importe: -45 },
        { valor: '01/10/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
        { valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -60 },
        { valor: '08/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -40 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 5' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // 100 € in 10 days is 310 € by the 31st, plus the 45 € gym fee charged in August and September.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('month-expenses')).toHaveText('100,00 €');
  await expect(page.getByTestId('month-forecast')).toHaveText('A este ritmo gastarás 355,00 € este mes');

  await page.getByRole('button', { name: 'Mes anterior' }).click();
  await expect(page.getByText('septiembre 2026')).toBeVisible();
  await expect(page.getByTestId('month-expenses')).toHaveText('45,00 €');
  await expect(page.getByTestId('month-forecast')).toHaveCount(0);
});
