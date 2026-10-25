import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

/** The clock reads Saturday 10 October 2026: 10 days elapsed of 31. */
async function setup(now = () => new Date('2026-10-10T10:00:00')) {
  const repo = createDexieRepository({ name: `kuenta-forecast-test-${++dbCount}`, now });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return repo;
}

async function importFile(repo: DataRepository, movements: SampleMovement[]) {
  const result = await repo.previewImport(await bbvaXlsx(movements, { startBalance: 3000 }), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return repo.commitImport(result.preview);
}

const card = (valor: string, concepto: string, importe: number): SampleMovement => ({ valor, concepto, movimiento: 'Pago con tarjeta', importe });

/** 100 € spent in October by the 10th: 310 € by the end of the month at that pace. */
const october: SampleMovement[] = [
  { valor: '01/10/2026', concepto: 'Abono de nómina', movimiento: 'Empresa ejemplo', importe: 1500 },
  card('02/10/2026', 'Mercadona', -60),
  card('08/10/2026', 'Mercadona', -40),
];

describe('the forecast on Inicio', () => {
  it('adds the charge of a payee charged in August and September and not yet in October, at September’s amount', async () => {
    const repo = await setup();
    await importFile(repo, [card('05/08/2026', 'Gimnasio Vital', -40), card('05/09/2026', 'Gimnasio Vital', -45), ...october]);

    // 100 € / 10 days × 31 days + 45 € expected.
    expect((await repo.home('2026-10')).forecast).toBe(31000 + 4500);
  });

  it('expects the sum of last month’s expenses when the payee charged several times', async () => {
    const repo = await setup();
    await importFile(repo, [
      card('01/08/2026', 'Alquiler Piso', -700),
      card('01/09/2026', 'Alquiler Piso', -700),
      card('15/09/2026', 'Alquiler Piso', -30.5),
      ...october,
    ]);

    expect((await repo.home('2026-10')).forecast).toBe(31000 + 73050);
  });

  it('doesn’t expect a payee charged only in September', async () => {
    const repo = await setup();
    await importFile(repo, [card('12/09/2026', 'Nueva Tienda', -20), ...october]);

    expect((await repo.home('2026-10')).forecast).toBe(31000);
  });

  it('extrapolates a payee already charged in October instead of expecting it again', async () => {
    const repo = await setup();
    await importFile(repo, [
      card('03/08/2026', 'Cine Ideal', -10.99),
      card('03/09/2026', 'Cine Ideal', -10.99),
      card('03/10/2026', 'Cine Ideal', -10.99),
      ...october,
    ]);

    // (100 € + 10,99 €) / 10 × 31 = 344,069 €, rounded to the cent.
    expect((await repo.home('2026-10')).forecast).toBe(34407);
  });

  it('ignores transfers, both as expected charges and as spending so far', async () => {
    const repo = await setup();
    const { id: revolutId } = (await repo.createAccount({ name: 'Revolut', type: 'bank', icon: 'banknote', color: 'cyan' })) as { id: string };
    await importFile(repo, [
      card('20/08/2026', 'Revolut**5625*', -200),
      card('20/09/2026', 'Revolut**5625*', -200),
      ...october,
      card('09/10/2026', 'Revolut**7311*', -300),
    ]);
    for (const month of ['2026-08', '2026-09', '2026-10']) {
      for (const tx of (await repo.listTransactions(month)).filter((t) => t.bankConcept?.startsWith('Revolut'))) {
        await repo.updateTransaction(tx.id, { transferAccountId: revolutId });
      }
    }

    // The August and September top-ups expect nothing in October, and October's 300 € aren't spending.
    expect((await repo.home('2026-10')).forecast).toBe(31000);
  });

  it('is null on the 1st and 2nd, and shown from the 3rd', async () => {
    const movements = [card('01/10/2026', 'Mercadona', -30)];
    const first = await setup(() => new Date('2026-10-01T20:00:00'));
    await importFile(first, movements);
    expect((await first.home('2026-10')).forecast).toBeNull();

    const second = await setup(() => new Date('2026-10-02T20:00:00'));
    await importFile(second, movements);
    expect((await second.home('2026-10')).forecast).toBeNull();

    const third = await setup(() => new Date('2026-10-03T08:00:00'));
    await importFile(third, movements);
    // 30 € / 3 days × 31 days.
    expect((await third.home('2026-10')).forecast).toBe(31000);
  });

  it('is null for past months', async () => {
    const repo = await setup();
    await importFile(repo, [card('05/08/2026', 'Gimnasio Vital', -40), card('05/09/2026', 'Gimnasio Vital', -45), ...october]);

    expect((await repo.home('2026-09')).forecast).toBeNull();
    expect((await repo.home('2026-08')).forecast).toBeNull();
  });
});
