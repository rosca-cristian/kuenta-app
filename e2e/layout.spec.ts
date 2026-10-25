import { expect, test, type Locator, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

const sheet = (page: Page) => page.getByRole('dialog');

/** Every route with its heading, and something that shows once its data has loaded. */
const ROUTES: { path: string; heading: string; loaded: (page: Page) => Locator }[] = [
  { path: '', heading: 'Inicio', loaded: (page) => page.getByTestId('total-balance') },
  { path: 'movimientos', heading: 'Movimientos', loaded: (page) => page.getByText(/Mercadona/).first() },
  { path: 'importar', heading: 'Importar', loaded: (page) => page.getByText('6 creados', { exact: false }) },
  { path: 'analisis/gastos', heading: 'Análisis', loaded: (page) => page.getByTestId('spending-donut') },
  { path: 'analisis/mensual', heading: 'Análisis', loaded: (page) => page.getByTestId('monthly-chart') },
  { path: 'analisis/patrimonio', heading: 'Análisis', loaded: (page) => page.getByTestId('net-worth-chart') },
  { path: 'analisis/suscripciones', heading: 'Análisis', loaded: (page) => page.getByRole('list', { name: 'Suscripciones' }) },
  { path: 'mas', heading: 'Más', loaded: (page) => page.getByText('Espacio usado', { exact: false }) },
  { path: 'mas/cuentas', heading: 'Cuentas', loaded: (page) => page.getByText('Cuenta de ahorro para la entrada del piso') },
  { path: 'mas/categorias', heading: 'Categorías', loaded: (page) => page.getByText('Supermercado').first() },
  { path: 'mas/comercios', heading: 'Comercios', loaded: (page) => page.getByText('Netflix').first() },
  { path: 'mas/reglas', heading: 'Reglas', loaded: (page) => page.getByText('Mercadona').first() },
  { path: 'mas/presupuestos', heading: 'Presupuestos', loaded: (page) => page.getByTestId('budget-spent') },
  { path: 'mas/objetivos', heading: 'Objetivos', loaded: (page) => page.getByText('Entrada del piso en el centro de la ciudad') },
  { path: 'mas/copias', heading: 'Copias de seguridad', loaded: (page) => page.getByTestId('csv-range-count').getByText('movimientos') },
  { path: 'mas/licencias', heading: 'Licencias', loaded: (page) => page.getByText('recharts') },
];

/**
 * Three months of large amounts and long bank texts, a subscription, a non-imported account
 * with a long name, a budget and a goal: what makes a screen wider than the phone if anything does.
 */
async function fillWithData(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByTestId('file-input').setInputFiles(
    bbvaXlsxFile(
      [
        { valor: '15/08/2026', concepto: 'Netflix', movimiento: 'Pago con tarjeta', importe: -12.99 },
        { valor: '01/09/2026', concepto: 'Abono de nómina', movimiento: 'Empresa con un nombre muy largo de verdad S.L.', importe: 123456.78 },
        { valor: '15/09/2026', concepto: 'Netflix', movimiento: 'Pago con tarjeta', importe: -12.99 },
        {
          valor: '20/09/2026',
          concepto: 'Compra en establecimiento comercial con un nombre larguísimo que no cabe en una línea',
          movimiento: 'Pago con tarjeta de crédito en comercio',
          importe: -98765.43,
        },
        { valor: '02/10/2026', concepto: 'Mercadona - crta del inge', movimiento: 'Pago con tarjeta', importe: -1234.56 },
        { valor: '15/10/2026', concepto: 'Netflix', movimiento: 'Pago con tarjeta', importe: -12.99 },
      ],
      { startBalance: 999999.99 },
    ),
  );
  await page.getByRole('button', { name: 'Importar 6' }).click();
  await expect(page.getByTestId('balance-check')).toHaveText('✓ Cuadra');

  // Netflix as a subscription, through the suggested rule.
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await page.getByRole('button', { name: /Netflix/ }).click();
  await page.getByRole('button', { name: 'Suscripciones' }).click();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Crear regla' }).click();

  await page.goto('./#/mas/cuentas');
  await page.getByRole('button', { name: 'Nueva' }).click();
  await sheet(page).getByLabel('Nombre').fill('Cuenta de ahorro para la entrada del piso');
  await sheet(page).getByLabel('Saldo inicial').fill('250.000,00');
  await sheet(page).getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(sheet(page)).toHaveCount(0);

  await page.goto('./#/mas/presupuestos');
  await page.getByRole('button', { name: 'Añadir presupuesto' }).click();
  await sheet(page).getByRole('button', { name: 'Supermercado' }).click();
  await sheet(page).getByLabel('Límite mensual').fill('1.000');
  await sheet(page).getByRole('button', { name: 'Añadir presupuesto' }).click();
  await expect(sheet(page)).toHaveCount(0);

  await page.goto('./#/mas/objetivos');
  await page.getByRole('button', { name: 'Nuevo objetivo' }).click();
  await sheet(page).getByLabel('Nombre').fill('Entrada del piso en el centro de la ciudad');
  await sheet(page).getByLabel('Objetivo').fill('900.000');
  await sheet(page).getByRole('button', { name: /^Cuenta de ahorro/ }).click();
  await sheet(page).getByRole('button', { name: 'Crear objetivo' }).click();
  await expect(sheet(page)).toHaveCount(0);
}

test('every screen fits a 390 px phone with data, without scrolling sideways', async ({ page }) => {
  // Tuesday 20 October 2026.
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00'));
  await fillWithData(page);

  for (const { path, heading, loaded } of ROUTES) {
    await page.goto(`./#/${path}`);
    await expect(page.getByRole('heading', { name: heading, exact: true }), path).toBeVisible();
    await expect(loaded(page), path).toBeVisible();
    const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(widths[0], `${path || 'inicio'} scrolls sideways`).toBeLessThanOrEqual(widths[1]);
  }
});
