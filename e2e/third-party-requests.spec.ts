import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

/** "dd/mm/aaaa" for a day of this month, or of `offset` months from it. */
function dayOf(day: number, offset = 0): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offset, day);
  return `${String(day).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

const MORE_SCREENS = ['Cuentas', 'Categorías', 'Comercios', 'Reglas', 'Presupuestos', 'Objetivos', 'Copias de seguridad'];

async function exportFile(page: Page, button: string) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  await downloading;
}

test('no request ever leaves the app’s own origin', async ({ page, context, baseURL }) => {
  const appOrigin = new URL(baseURL!).origin;
  // The context sees the pages' requests and the service worker's (its precache downloads included).
  const requests: { url: string; fromServiceWorker: boolean }[] = [];
  context.on('request', (request) => requests.push({ url: request.url(), fromServiceWorker: request.serviceWorker() !== null }));

  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  // First run.
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Import.
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: dayOf(5, -2), concepto: 'Netflix', movimiento: 'Pago con tarjeta', importe: -12.99 },
        { valor: dayOf(5, -1), concepto: 'Netflix', movimiento: 'Pago con tarjeta', importe: -12.99 },
        { valor: dayOf(1), concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
        { valor: dayOf(1), concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -80 },
      ],
      { startBalance: 1000 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 4' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Inicio and Movimientos.
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('total-balance')).toBeVisible();
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(page.locator('main').getByRole('listitem')).toHaveCount(2);

  // Every tab of Análisis.
  await page.getByRole('link', { name: 'Análisis' }).click();
  await expect(page.getByTestId('spending-donut').locator('.recharts-pie-sector')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Mensual' }).click();
  await expect(page.getByTestId('monthly-chart')).toBeVisible();
  await page.getByRole('tab', { name: 'Patrimonio' }).click();
  await expect(page.getByTestId('net-worth-chart')).toBeVisible();
  await page.getByRole('tab', { name: 'Suscripciones' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Suscripciones' })).toBeVisible();

  // Every screen of Más.
  for (const screen of MORE_SCREENS) {
    await page.getByRole('link', { name: 'Más' }).click();
    await page.getByRole('link', { name: screen }).click();
    await expect(page.getByRole('heading', { name: screen })).toBeVisible();
  }

  // Copias de seguridad's exports: the backup, its share fallback and the CSV.
  await exportFile(page, 'Exportar copia');
  await exportFile(page, 'Compartir copia');
  await exportFile(page, 'Exportar movimientos (CSV)');

  // The recording works: it saw the app's own requests, the service worker's among them.
  expect(requests.some((request) => request.url.startsWith(appOrigin))).toBe(true);
  expect(requests.some((request) => request.fromServiceWorker)).toBe(true);

  const isLocal = (url: string) => url.startsWith('data:') || url.startsWith('blob:') || new URL(url).origin === appOrigin;
  expect(requests.filter((request) => !isLocal(request.url)).map((request) => request.url)).toEqual([]);
});
