import { expect, test, type Page } from '@playwright/test';

/**
 * Leaves in the browser the database of a Part 1 install (schema version 1, no rules)
 * with this month imported: two Mercadona purchases and a Kfc never edited, and a bar
 * the user categorized by hand. The app then opens it as an update would.
 */
async function installPartOne(page: Page) {
  // Any page of the app's origin that doesn't start the app.
  await page.goto('./icons/icon-192.png');
  await page.evaluate(async () => {
    const now = new Date();
    const day = (d: number) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const stamp = now.toISOString();
    let balance = 100000;
    const tx = (id: string, d: number, concept: string, amount: number, extra: object = {}) => {
      balance += amount;
      return {
        id, type: amount < 0 ? 'expense' : 'income', amount: Math.abs(amount), date: day(d), accountId: 'acc-bbva', toAccountId: null,
        categoryId: null, payeeId: null, note: '', source: 'import', importBatchId: 'batch-1', importHash: `hash-${id}`,
        bookingDate: day(d), bankConcept: concept, bankMovement: 'Pago con tarjeta', bankBalance: balance, editedAt: null,
        createdAt: stamp, updatedAt: stamp, ...extra,
      };
    };
    const rows: Record<string, object[]> = {
      accounts: [{ id: 'acc-bbva', name: 'BBVA', type: 'bank', openingBalance: 100000, color: 'blue', icon: 'landmark', archived: false, order: 0, createdAt: stamp, updatedAt: stamp }],
      // Part 1's starter categories, abridged: the update adds the missing ones.
      categories: [
        { id: 'cat-0', name: 'Supermercado', kind: 'expense', icon: 'shopping-cart', color: 'green', order: 0, archived: false },
        { id: 'cat-1', name: 'Restaurantes', kind: 'expense', icon: 'utensils', color: 'orange', order: 1, archived: false },
      ],
      payees: [],
      transactions: [
        tx('tx-1', 1, 'Mercadona', -2000),
        tx('tx-2', 2, 'Bar ejemplo', -4000, { categoryId: 'cat-1', editedAt: stamp }),
        tx('tx-3', 3, 'Kfc', -900),
        tx('tx-4', 4, 'Mercadona', -3000),
      ],
      importBatches: [],
      settings: [
        { key: 'importAccountId', value: 'acc-bbva' },
        { key: 'onboardingDone', value: true },
        { key: 'persistRequested', value: true },
      ],
    };
    await new Promise<void>((resolve, reject) => {
      // Dexie's version 1 is IndexedDB version 10.
      const request = indexedDB.open('kuenta', 10);
      request.onupgradeneeded = () => {
        const db = request.result;
        const store = (name: string, key: string, indexes: [string, string | string[], boolean?][]) => {
          const s = db.createObjectStore(name, { keyPath: key });
          for (const [index, path, unique] of indexes) s.createIndex(index, path, { unique: unique ?? false });
          for (const row of rows[name]) s.add(row);
        };
        store('accounts', 'id', [['order', 'order']]);
        store('categories', 'id', [['kind', 'kind'], ['order', 'order']]);
        store('payees', 'id', [['normalized', 'normalized', true]]);
        store('transactions', 'id', [
          ['date', 'date'], ['[accountId+date]', ['accountId', 'date']], ['[toAccountId+date]', ['toAccountId', 'date']],
          ['categoryId', 'categoryId'], ['payeeId', 'payeeId'], ['importHash', 'importHash', true], ['importBatchId', 'importBatchId'],
          ['bookingDate', 'bookingDate'],
        ]);
        store('importBatches', 'id', [['importedAt', 'importedAt']]);
        store('settings', 'key', []);
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.goto('./');
}

const offer = (page: Page) => page.getByText('Aplicar las reglas de serie a 2 movimientos ya importados');

test('after the update, apply the starter rules to what was already imported', async ({ page }) => {
  await installPartOne(page);
  await expect(offer(page)).toBeVisible();
  await expect(page.getByText('3 movimientos sin categoría')).toBeVisible();

  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Reglas de serie aplicadas: 2 movimientos cambiados.');
  await expect(page.getByText('1 movimiento sin categoría')).toBeVisible();
  await expect(offer(page)).toHaveCount(0);

  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(page.getByRole('button', { name: /Supermercado/ })).toHaveCount(2);

  // Gone for good.
  await page.reload();
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByText('1 movimiento sin categoría')).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
});

test('dismissing the offer changes nothing and hides it for good', async ({ page }) => {
  await installPartOne(page);
  await page.getByRole('button', { name: 'Descartar' }).click();
  await expect(offer(page)).toHaveCount(0);
  await expect(page.getByText('3 movimientos sin categoría')).toBeVisible();

  await page.reload();
  await expect(page.getByText('3 movimientos sin categoría')).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
});
