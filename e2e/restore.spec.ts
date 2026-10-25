import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

/** Onboards and imports two October rows. */
async function onboardAndImport(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: '01/10/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
        { valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -12.5 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 2' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');
}

async function openBackups(page: Page) {
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Copias de seguridad' }).click();
  await expect(page.getByRole('heading', { name: 'Copias de seguridad' })).toBeVisible();
}

test('restore a backup over changed data and get the original data back', async ({ page }) => {
  // Tuesday 20 October 2026.
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00'));
  await onboardAndImport(page);
  await page.getByRole('link', { name: 'Inicio' }).click();
  const original = await page.getByTestId('total-balance').textContent();
  await openBackups(page);

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar copia' }).click();
  const backupPath = await (await downloading).path();

  // Undoing the import changes the data.
  await page.clock.setFixedTime(new Date('2026-10-22T09:00:00'));
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
  await page.getByRole('button', { name: 'Deshacer importación' }).click();
  await expect(page.getByText('Deshecha')).toBeVisible();
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('total-balance')).not.toHaveText(original!);

  await openBackups(page);
  await page.getByTestId('backup-input').setInputFiles(backupPath);
  const sheet = page.getByRole('dialog', { name: 'Restaurar copia' });
  await expect(sheet.getByTestId('backup-summary')).toHaveText(/^Copia del 20\/10\/2026: 1 cuenta, 2 movimientos, \d+ categorías/);
  await expect(sheet.getByTestId('current-data')).toContainText('1 cuenta, 0 movimientos');
  await expectNoHorizontalScroll(page);

  // Exporting the current data first downloads a backup of it, which counts as one.
  const exporting = page.waitForEvent('download');
  await sheet.getByRole('button', { name: 'Exportar mis datos actuales antes' }).click();
  expect((await exporting).suggestedFilename()).toBe('kuenta-copia-2026-10-22.json');
  await expect(sheet.getByRole('status')).toHaveText('Datos actuales exportados.');

  await sheet.getByRole('button', { name: 'Sustituir todos mis datos' }).click();
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  await expect(page.getByText('Copia restaurada', { exact: false })).toBeVisible();
  await expect(page.getByTestId('total-balance')).toHaveText(original!);

  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(page.getByText('Mercadona')).toBeVisible();
  await page.getByRole('link', { name: 'Importar' }).click();
  await expect(page.getByText('Deshecha')).toHaveCount(0);

  // The restored data equals the copy of the 20th: that's the last backup now.
  await openBackups(page);
  await expect(page.getByTestId('last-backup')).toHaveText('Última copia: 20/10/2026');
});

test('a file that is not a Kuenta backup is refused and changes nothing', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00'));
  await onboardAndImport(page);
  await page.getByRole('link', { name: 'Inicio' }).click();
  const balance = await page.getByTestId('total-balance').textContent();
  await openBackups(page);

  await page.getByTestId('backup-input').setInputFiles({
    name: 'otra-cosa.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'otra', datos: [] })),
  });
  const sheet = page.getByRole('dialog', { name: 'Restaurar copia' });
  await expect(sheet.getByRole('alert')).toHaveText('El archivo no es una copia de Kuenta.');
  await expect(sheet.getByRole('button', { name: 'Sustituir todos mis datos' })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('total-balance')).toHaveText(balance!);
  await expect(page.getByText('Copia restaurada', { exact: false })).toHaveCount(0);
});
