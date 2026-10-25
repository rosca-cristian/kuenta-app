import { expect, test, type Page } from '@playwright/test';

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test("Ajustes shows the space used and the libraries' licences", async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('link', { name: 'Más' }).click();

  // The space Kuenta's data takes on this phone, in megabytes with one decimal.
  await expect(page.getByTestId('storage-usage')).toHaveText(/^\d{1,3}(\.\d{3})*,\d MB$/);
  await expectNoHorizontalScroll(page);

  // Licencias lists each library with its version and licence.
  await page.getByRole('link', { name: 'Licencias' }).click();
  await expect(page.getByRole('heading', { name: 'Licencias' })).toBeVisible();
  const library = (name: string) =>
    page.getByRole('list', { name: 'Bibliotecas' }).getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });
  await expect(library('react')).toContainText('MIT');
  await expect(library('react')).toContainText(/\d+\.\d+\.\d+/);
  await expect(library('dexie')).toContainText('Apache-2.0');
  await expectNoHorizontalScroll(page);

  await page.getByRole('link', { name: 'Volver' }).click();
  await expect(page.getByRole('heading', { name: 'Más' })).toBeVisible();
});
