import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

/** "dd/mm/aaaa" for a day of this month, or of `offset` months from it. */
function dayOf(day: number, offset = 0): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offset, day);
  return `${String(day).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

/** Taps the button and returns the downloaded file's name and text. */
async function download(page: Page, button: string) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  const file = await downloading;
  return { name: file.suggestedFilename(), text: await readFile(await file.path(), 'utf8') };
}

test('after the first visit the app works with no connection: open, import, browse, charts and exports', async ({ page, context }) => {
  // First visit, online: the service worker installs and precaches the app. Without clients.claim()
  // it controls the page from the next load, so reload once while still online.
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Empezar' })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // No connection from here on: every request the page makes fails unless the service worker serves it.
  await context.setOffline(true);
  // Offline covers the service worker's own requests too: a same-origin file it hasn't precached
  // goes through it to the network and fails, instead of getting the preview server's answer.
  expect(await page.evaluate(() => fetch('./not-precached.txt').then(() => 'online', () => 'offline'))).toBe('offline');
  const served: { url: string; fromServiceWorker: boolean }[] = [];
  page.on('response', (response) => served.push({ url: response.url(), fromServiceWorker: response.fromServiceWorker() }));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Empezar' })).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  // The page and its scripts came from the service worker, which can only answer from its cache.
  expect(served.length).toBeGreaterThan(0);
  expect(served.filter((response) => !response.fromServiceWorker)).toEqual([]);

  // First run.
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Importar', exact: true })).toBeVisible();

  // Import a synthetic BBVA file over two months, with a subscription-like monthly charge.
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: dayOf(5, -2), concepto: 'Netflix', movimiento: 'Pago con tarjeta', importe: -12.99 },
        { valor: dayOf(5, -1), concepto: 'Netflix', movimiento: 'Pago con tarjeta', importe: -12.99 },
        { valor: dayOf(1), concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
        { valor: dayOf(1), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -80 },
        { valor: dayOf(1), concepto: 'Glovo', movimiento: 'Pago con tarjeta', importe: -35 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 5' }).click();
  await expect(page.getByTestId('import-created')).toHaveText('5 movimientos creados');
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Movimientos lists this month's rows.
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(page.getByRole('heading', { name: 'Movimientos' })).toBeVisible();
  await expect(page.locator('main').getByRole('listitem')).toHaveCount(3);

  // Análisis, a lazy chunk with Recharts, and each of its tabs with its chart.
  await page.getByRole('link', { name: 'Análisis' }).click();
  await expect(page.getByTestId('spending-donut').locator('.recharts-pie-sector')).toHaveCount(2);
  await expect(page.getByTestId('spending-total')).toHaveText('115,00 €');
  await page.getByRole('tab', { name: 'Mensual' }).click();
  await expect(page.getByTestId('monthly-chart').locator('.recharts-bar-rectangle').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Patrimonio' }).click();
  await expect(page.getByTestId('net-worth-chart').locator('.recharts-line')).toBeVisible();
  await page.getByRole('tab', { name: 'Suscripciones' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Suscripciones' })).toBeVisible();

  // A backup and a CSV from Copias de seguridad.
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Copias de seguridad' }).click();
  const backup = await download(page, 'Exportar copia');
  expect(backup.name).toMatch(/^kuenta-copia-\d{4}-\d{2}-\d{2}\.json$/);
  expect(JSON.parse(backup.text).data.transactions).toHaveLength(5);
  const csv = await download(page, 'Exportar movimientos (CSV)');
  expect(csv.name).toMatch(/^kuenta-movimientos-\d{4}-\d{2}-\d{2}\.csv$/);
  // The BOM, the header and the five rows.
  expect(csv.text.split('\r\n').filter(Boolean)).toHaveLength(6);
  expect(csv.text).toContain('Abono de nómina');

  // Still nothing reached the network.
  expect(served.filter((response) => !response.fromServiceWorker)).toEqual([]);
});
