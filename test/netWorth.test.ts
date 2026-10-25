import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository, NetWorthView } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

/** A repository whose clock the test can move; it starts on Tuesday 20 October 2026, as in the other repository tests. */
async function setup() {
  const clock = { now: new Date('2026-10-20T10:00:00') };
  const repo = createDexieRepository({ name: `kuenta-net-worth-test-${++dbCount}`, now: () => clock.now });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return { repo, clock };
}

async function importFile(repo: DataRepository, movements: SampleMovement[], startBalance: number) {
  const result = await repo.previewImport(await bbvaXlsx(movements, { startBalance }), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return repo.commitImport(result.preview);
}

async function createAccount(repo: DataRepository, name: string, openingBalance: number) {
  const result = await repo.createAccount({ name, type: 'savings', icon: 'piggy-bank', color: 'pink', openingBalance });
  if (!result.ok) throw new Error(result.reason);
  return result.id;
}

/** Each point as [month, date, net worth]. */
const points = (view: NetWorthView) => view.points.map((point) => [point.month, point.date, point.netWorth]);

/** BBVA opens at 2.000 €: −100 € in August, +500 € in September, −50 € in October. */
const movements: SampleMovement[] = [
  { valor: '10/08/2026', concepto: 'Mercadona', movimiento: 'Agosto', importe: -100 },
  { valor: '15/09/2026', concepto: 'Abono de nómina', movimiento: 'Nómina septiembre', importe: 500 },
  { valor: '05/10/2026', concepto: 'Mercadona', movimiento: 'Octubre', importe: -50 },
];

describe('net worth over the last 12 months', () => {
  it("is every account's balance on each month's last day, from the month of the first transaction", async () => {
    const { repo } = await setup();
    await importFile(repo, movements, 2000);

    // BBVA alone: months before August have no transactions, so they're left out.
    expect(points(await repo.netWorth())).toEqual([
      ['2026-08', '2026-08-31', 190000],
      ['2026-09', '2026-09-30', 240000],
      ['2026-10', '2026-10-20', 235000],
    ]);
  });

  it('counts the opening balance of a non-imported account and the balance of an archived one', async () => {
    const { repo } = await setup();
    await importFile(repo, movements, 2000);
    await createAccount(repo, 'Revolut', 30000);
    await repo.setAccountArchived(await createAccount(repo, 'Hucha', 10000), true);

    const view = await repo.netWorth();
    expect(points(view)).toEqual([
      ['2026-08', '2026-08-31', 230000],
      ['2026-09', '2026-09-30', 280000],
      ['2026-10', '2026-10-20', 275000],
    ]);
    // Today's point is Inicio's total balance, archived accounts included.
    expect(view.latest).toBe((await repo.home('2026-10')).totalBalance);
    expect(view.latest).toBe(275000);
  });

  it('gives the latest net worth and its change against the previous month, none with a single point', async () => {
    const { repo } = await setup();
    expect(await repo.netWorth()).toEqual({ points: [], latest: null, change: null });

    await importFile(repo, movements.slice(2), 2050);
    expect(await repo.netWorth()).toMatchObject({ latest: 200000, change: null });
    expect(points(await repo.netWorth())).toEqual([['2026-10', '2026-10-20', 200000]]);

    const { repo: full } = await setup();
    await importFile(full, movements, 2000);
    expect(await full.netWorth()).toMatchObject({ latest: 235000, change: -5000 });
  });

  it("uses today for the current month's point and the month's last day once it's over", async () => {
    const { repo, clock } = await setup();
    await importFile(repo, movements, 2000);
    await importFile(repo, [{ valor: '25/10/2026', concepto: 'Mercadona', movimiento: 'Más tarde', importe: -30 }], 2350);

    // On the 20th, the row of the 25th hasn't happened yet.
    expect(points(await repo.netWorth()).at(-1)).toEqual(['2026-10', '2026-10-20', 235000]);

    clock.now = new Date('2026-11-02T09:00:00');
    expect(points(await repo.netWorth()).slice(-2)).toEqual([
      ['2026-10', '2026-10-31', 232000],
      ['2026-11', '2026-11-02', 232000],
    ]);
  });

  it('keeps only the last 12 months, the current one included', async () => {
    const { repo } = await setup();
    await importFile(
      repo,
      [
        { valor: '10/06/2025', concepto: 'Mercadona', movimiento: 'Junio', importe: -10 },
        { valor: '10/11/2025', concepto: 'Mercadona', movimiento: 'Noviembre', importe: -20 },
      ],
      1000,
    );

    const view = await repo.netWorth();
    expect(view.points).toHaveLength(12);
    expect(points(view)[0]).toEqual(['2025-11', '2025-11-30', 97000]);
    expect(points(view)[11]).toEqual(['2026-10', '2026-10-20', 97000]);
  });

  it("doesn't change with a transfer between two accounts, and changes with a balance adjustment", async () => {
    const { repo } = await setup();
    const revolutId = await createAccount(repo, 'Revolut', 0);
    await importFile(repo, movements, 2000);
    const before = await repo.netWorth();

    // 200 € leave BBVA for Revolut: the user is no richer or poorer.
    await importFile(repo, [{ valor: '09/10/2026', concepto: 'Revolut**5625*', movimiento: 'Recarga', importe: -200 }], 2350);
    const topUp = (await repo.listTransactions('2026-10')).find((tx) => tx.bankMovement === 'Recarga')!;
    await repo.updateTransaction(topUp.id, { transferAccountId: revolutId });
    expect(await repo.netWorth()).toEqual(before);

    // Revolut actually holds 250 €: a +50 € adjustment dated today raises this month's point only.
    await repo.updateAccountBalance(revolutId, 25000);
    const after = await repo.netWorth();
    expect(points(after)).toEqual([
      ['2026-08', '2026-08-31', 190000],
      ['2026-09', '2026-09-30', 240000],
      ['2026-10', '2026-10-20', 240000],
    ]);
    expect(after.change).toBe(0);
  });
});
