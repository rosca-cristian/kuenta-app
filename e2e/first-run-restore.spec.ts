import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

/** The `persistRequested` setting as stored in the app's IndexedDB. */
function persistRequested(page: Page) {
  return page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open('kuenta');
        request.onsuccess = () => {
          const db = request.result;
          const get = db.transaction('settings').objectStore('settings').get('persistRequested');
          get.onsuccess = () => {
            db.close();
            resolve(get.result?.value ?? null);
          };
          get.onerror = () => reject(get.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
}

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test('restore a backup on a new phone from the welcome screen', async ({ page, browser }) => {
  // The old phone: onboard, import two October rows and export a backup.
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00'));
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
  await page.getByRole('link', { name: 'Inicio' }).click();
  const balance = await page.getByTestId('total-balance').textContent();
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Copias de seguridad' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar copia' }).click();
  const backupPath = await (await downloading).path();

  // The new phone: a fresh browser with no data.
  const context = await browser.newContext();
  const phone = await context.newPage();
  await phone.clock.setFixedTime(new Date('2026-10-25T12:00:00'));
  await phone.goto('./');
  await expect(phone.getByRole('button', { name: 'Empezar' })).toBeVisible();
  await expectNoHorizontalScroll(phone);

  await phone.getByTestId('backup-input').setInputFiles(backupPath);
  const sheet = phone.getByRole('dialog', { name: 'Restaurar copia' });
  await expect(sheet.getByTestId('backup-summary')).toHaveText(/^Copia del 20\/10\/2026: 1 cuenta, 2 movimientos, \d+ categorías/);
  // There's no current data to show or export.
  await expect(sheet.getByTestId('current-data')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Exportar mis datos actuales antes' })).toHaveCount(0);
  await expectNoHorizontalScroll(phone);

  await sheet.getByRole('button', { name: 'Sustituir todos mis datos' }).click();
  await expect(phone.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  await expect(phone.getByText('Copia restaurada', { exact: false })).toBeVisible();
  await expect(phone.getByTestId('total-balance')).toHaveText(balance!);
  // Persistent storage was requested, as "Empezar" does.
  expect(await persistRequested(phone)).toBe(true);

  await phone.getByRole('link', { name: 'Movimientos' }).click();
  await expect(phone.getByText('Mercadona')).toBeVisible();
  await expect(phone.getByText('Abono de nómina')).toBeVisible();

  // The copy is this phone's last backup, and the app stays set up after a reload.
  await phone.reload();
  await expect(phone.getByRole('link', { name: 'Más' })).toBeVisible();
  await phone.getByRole('link', { name: 'Más' }).click();
  await phone.getByRole('link', { name: 'Copias de seguridad' }).click();
  await expect(phone.getByTestId('last-backup')).toHaveText('Última copia: 20/10/2026');
  await context.close();
});

test('a bad file on the welcome screen shows the error and Empezar still works', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('backup-input').setInputFiles({
    name: 'notas.json',
    mimeType: 'application/json',
    buffer: Buffer.from('esto no es json'),
  });
  const sheet = page.getByRole('dialog', { name: 'Restaurar copia' });
  await expect(sheet.getByRole('alert')).toHaveText('El archivo no es una copia de Kuenta.');
  await expect(sheet.getByRole('button', { name: 'Sustituir todos mis datos' })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Kuenta' })).toBeVisible();
  await page.getByRole('button', { name: 'Empezar' }).click();
  await expect(page.getByText('haz copias de seguridad en Más → Copias de seguridad', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByTestId('file-input')).toBeAttached();
  await expect(page.getByRole('heading', { name: 'Importar', exact: true })).toBeVisible();
});
