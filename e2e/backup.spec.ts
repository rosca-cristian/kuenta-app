import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { bbvaXlsxFile } from './support/xlsx';

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

/** Onboards, imports two October rows and opens Más → Copias de seguridad. */
async function openBackups(page: Page) {
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
  await page.getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: 'Copias de seguridad' }).click();
  await expect(page.getByRole('heading', { name: 'Copias de seguridad' })).toBeVisible();
}

/** Taps the button and returns the downloaded file's name and parsed JSON. */
async function download(page: Page, button: string) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  const file = await downloading;
  return { name: file.suggestedFilename(), json: JSON.parse(await readFile(await file.path(), 'utf8')) };
}

test('export a JSON backup and share it, which downloads it without file sharing', async ({ page }) => {
  // Tuesday 20 October 2026.
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00'));
  await openBackups(page);
  const lastBackup = page.getByTestId('last-backup');
  await expect(lastBackup).toHaveText('Última copia: Nunca');
  await expectNoHorizontalScroll(page);

  const exported = await download(page, 'Exportar copia');
  expect(exported.name).toBe('kuenta-copia-2026-10-20.json');
  expect(exported.json).toMatchObject({ app: 'kuenta', format: 1 });
  expect(exported.json.data.transactions.map((tx: { bankConcept: string }) => tx.bankConcept).sort()).toEqual(['Abono de nómina', 'Mercadona']);
  await expect(lastBackup).toHaveText('Última copia: 20/10/2026');

  // Headless Chromium can't share files: "Compartir copia" downloads the same backup, which counts too.
  await page.clock.setFixedTime(new Date('2026-10-23T09:00:00'));
  const shared = await download(page, 'Compartir copia');
  expect(shared.name).toBe('kuenta-copia-2026-10-23.json');
  expect(shared.json).toMatchObject({ app: 'kuenta', format: 1 });
  expect(shared.json.data.transactions).toHaveLength(2);
  await expect(lastBackup).toHaveText('Última copia: 23/10/2026');
  await expectNoHorizontalScroll(page);
});

test('a cancelled share is not a backup; a completed one is', async ({ page }) => {
  // A browser that shares files, whose share menu the user closes.
  await page.addInitScript(() => {
    Object.assign(navigator, {
      canShare: () => true,
      share: () => Promise.reject(new DOMException('Share canceled', 'AbortError')),
    });
  });
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00'));
  await openBackups(page);
  const lastBackup = page.getByTestId('last-backup');
  const share = page.getByRole('button', { name: 'Compartir copia' });

  await share.click();
  await expect(share).toBeEnabled();
  await expect(lastBackup).toHaveText('Última copia: Nunca');

  // This time the user picks an app.
  await page.evaluate(() => {
    Object.assign(navigator, {
      share: async ({ files }: { files: File[] }) => {
        (window as unknown as { sharedName: string }).sharedName = files[0].name;
      },
    });
  });
  await share.click();
  await expect(lastBackup).toHaveText('Última copia: 20/10/2026');
  expect(await page.evaluate(() => (window as unknown as { sharedName: string }).sharedName)).toBe('kuenta-copia-2026-10-20.json');
});

test('Inicio reminds to make a backup after an import, until one is exported', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00'));
  await openBackups(page);
  await page.getByRole('link', { name: 'Inicio' }).click();
  const reminder = page.getByRole('button', { name: 'Haz una copia de seguridad' });
  await expect(reminder).toBeVisible();
  await expectNoHorizontalScroll(page);

  await reminder.click();
  await expect(page.getByRole('heading', { name: 'Copias de seguridad' })).toBeVisible();
  await download(page, 'Exportar copia');
  await expect(page.getByTestId('last-backup')).toHaveText('Última copia: 20/10/2026');

  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByTestId('total-balance')).toBeVisible();
  await expect(reminder).toHaveCount(0);
});
