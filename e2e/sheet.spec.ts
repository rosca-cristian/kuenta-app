import { expect, test, type Page } from '@playwright/test';

const sheet = (page: Page) => page.getByRole('dialog');

/** Drags with the pointer from the middle of `box` straight down by `distance` pixels. */
async function dragDown(page: Page, box: { x: number; y: number; width: number; height: number }, distance: number) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) await page.mouse.move(x, y + (distance * step) / 10);
  await page.mouse.up();
}

test('a sheet stays open when dragged inside, and closes from its cross or a tap outside', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Cuentas' }).click();

  // Swiping down over the form, as when scrolling to see what's typed, doesn't close it.
  await page.getByRole('button', { name: 'Nueva' }).click();
  await sheet(page).getByLabel('Nombre').fill('Revolut');
  await dragDown(page, (await sheet(page).getByLabel('Nombre').boundingBox())!, 400);
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByLabel('Nombre')).toHaveValue('Revolut');

  await sheet(page).getByRole('button', { name: 'Cerrar' }).click();
  await expect(sheet(page)).toHaveCount(0);

  // So does a tap outside it.
  await page.getByRole('button', { name: 'Nueva' }).click();
  await expect(sheet(page)).toBeVisible();
  await page.mouse.click(195, 20);
  await expect(sheet(page)).toHaveCount(0);
});
