import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import type { DataRepository, SubscriptionsView } from '../src/data/repository';
import { bbvaXlsx, type SampleMovement } from './support/bbvaXlsx';

let dbCount = 0;

/** The clock reads Tuesday 20 October 2026, as in the other repository tests. */
async function setup() {
  const repo = createDexieRepository({ name: `kuenta-subscriptions-test-${++dbCount}`, now: () => new Date('2026-10-20T10:00:00') });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return repo;
}

async function importFile(repo: DataRepository, movements: SampleMovement[]) {
  const result = await repo.previewImport(await bbvaXlsx(movements, { startBalance: 3000 }), 'movimientos.xlsx');
  if (!result.ok) throw new Error(result.error.message);
  return repo.commitImport(result.preview);
}

async function categoryId(repo: DataRepository, name: string) {
  const category = (await repo.listCategories()).find((c) => c.name === name);
  if (!category) throw new Error(`No category named ${name}`);
  return category.id;
}

/** Rules putting each concept in "Suscripciones", created before importing so the import applies them. */
async function subscriptionRules(repo: DataRepository, ...concepts: string[]) {
  const suscripciones = await categoryId(repo, 'Suscripciones');
  for (const concept of concepts) await repo.createRule({ name: concept, match: { value: concept }, actions: { categoryId: suscripciones } });
}

const card = (valor: string, concepto: string, importe: number, movimiento = 'Pago con tarjeta'): SampleMovement => ({ valor, concepto, movimiento, importe });

/** Each subscription's payee, frequency and monthly amount, in the order shown. */
const rows = (view: SubscriptionsView) => view.subscriptions.map((s) => [s.payee.name, s.frequency, s.monthlyAmount]);

const byName = (view: SubscriptionsView, name: string) => {
  const subscription = view.subscriptions.find((s) => s.payee.name === name);
  if (!subscription) throw new Error(`No subscription for ${name}`);
  return subscription;
};

/**
 * A year of charges. Netflix monthly, up 1 € in October; Spotify monthly with October's
 * charge still to come; the domain yearly; a new app charged once; a magazine every three
 * months; and Mercadona, a supermarket.
 */
const movements: SampleMovement[] = [
  card('01/10/2025', 'Dominio Web', -99),
  card('01/05/2026', 'Revista Mensual', -6),
  card('01/08/2026', 'Revista Mensual', -6),
  card('05/08/2026', 'Spotify', -10.99),
  card('15/08/2026', 'Netflix', -12.99),
  card('05/09/2026', 'Spotify', -10.99),
  card('15/09/2026', 'Netflix', -12.99),
  card('20/09/2026', 'Mercadona', -45),
  card('01/10/2026', 'Dominio Web', -119.99),
  card('02/10/2026', 'Mercadona', -30),
  card('12/10/2026', 'Nueva App', -4.99),
  card('15/10/2026', 'Netflix', -13.99),
];

const concepts = ['netflix', 'spotify', 'dominio web', 'nueva app', 'revista mensual'];

describe('subscriptions', () => {
  it('lists each payee with expenses in "Suscripciones" once, by name, and no others', async () => {
    const repo = await setup();
    await subscriptionRules(repo, ...concepts);
    await importFile(repo, movements);

    const view = await repo.subscriptions();
    expect(view.subscriptions.map((s) => s.payee.name)).toEqual(['Dominio Web', 'Netflix', 'Nueva App', 'Revista Mensual', 'Spotify']);
    expect(byName(view, 'Netflix')).toMatchObject({ lastAmount: 1399, lastDate: '2026-10-15' });
  });

  it('is monthly for consecutive months, yearly 11–13 months apart, assumed monthly for a single charge, and "—" otherwise', async () => {
    const repo = await setup();
    await subscriptionRules(repo, ...concepts);
    await importFile(repo, movements);

    const view = await repo.subscriptions();
    // Yearly: a twelfth of 119,99 €, rounded to the cent. Two charges three months apart have no frequency.
    expect(rows(view)).toEqual([
      ['Dominio Web', 'yearly', 1000],
      ['Netflix', 'monthly', 1399],
      ['Nueva App', 'monthly', 499],
      ['Revista Mensual', null, null],
      ['Spotify', 'monthly', 1099],
    ]);
    // Only the single charge's frequency is assumed.
    expect(view.subscriptions.map((s) => [s.payee.name, s.assumed])).toEqual([
      ['Dominio Web', false],
      ['Netflix', false],
      ['Nueva App', true],
      ['Revista Mensual', false],
      ['Spotify', false],
    ]);
    // Without a frequency, the last charge still shows.
    expect(byName(view, 'Revista Mensual')).toMatchObject({ lastAmount: 600, lastDate: '2026-08-01', monthlyAmount: null, nextDate: null });
  });

  it('assumes a single charge is monthly, a month after it, until a second charge confirms or corrects it', async () => {
    const repo = await setup();
    await subscriptionRules(repo, 'nueva app');
    await importFile(repo, [card('31/08/2026', 'Nueva App', -4.99)]);

    expect(byName(await repo.subscriptions(), 'Nueva App')).toMatchObject({
      frequency: 'monthly',
      assumed: true,
      monthlyAmount: 499,
      nextDate: '2026-09-30',
      priceRise: false,
      missingCharge: false,
    });

    // September's charge confirms it: monthly, no longer assumed.
    await importFile(repo, [card('30/09/2026', 'Nueva App', -4.99)]);
    expect(byName(await repo.subscriptions(), 'Nueva App')).toMatchObject({ frequency: 'monthly', assumed: false, monthlyAmount: 499, nextDate: '2026-10-30' });
  });

  it('leaves two charges in the same month without a frequency', async () => {
    const repo = await setup();
    await subscriptionRules(repo, 'nueva app');
    await importFile(repo, [card('02/10/2026', 'Nueva App', -4.99), card('12/10/2026', 'Nueva App', -4.99)]);

    const view = await repo.subscriptions();
    expect(byName(view, 'Nueva App')).toMatchObject({ frequency: null, assumed: false, monthlyAmount: null, nextDate: null });
    expect(view.totals).toMatchObject({ monthly: 0, yearly: 0 });
  });

  it('takes 11 and 13 months apart as yearly, but not 10 or 14', async () => {
    const repo = await setup();
    await subscriptionRules(repo, 'once', 'trece', 'diez', 'catorce');
    await importFile(repo, [
      card('10/08/2025', 'Catorce', -30),
      card('10/09/2025', 'Trece', -30),
      card('10/11/2025', 'Once', -36),
      card('10/12/2025', 'Diez', -30),
      card('10/10/2026', 'Catorce', -30),
      card('10/10/2026', 'Diez', -30),
      card('10/10/2026', 'Once', -36),
      card('10/10/2026', 'Trece', -30),
    ]);

    expect(rows(await repo.subscriptions())).toEqual([
      ['Catorce', null, null],
      ['Diez', null, null],
      ['Once', 'yearly', 300],
      ['Trece', 'yearly', 250],
    ]);
  });

  it('expects the next charge a month or a year after the last one', async () => {
    const repo = await setup();
    await subscriptionRules(repo, ...concepts, 'gimnasio');
    await importFile(repo, [...movements, card('31/08/2026', 'Gimnasio', -30), card('30/09/2026', 'Gimnasio', -30)]);

    const view = await repo.subscriptions();
    expect(byName(view, 'Netflix').nextDate).toBe('2026-11-15');
    expect(byName(view, 'Spotify').nextDate).toBe('2026-10-05');
    expect(byName(view, 'Dominio Web').nextDate).toBe('2027-10-01');
    expect(byName(view, 'Revista Mensual').nextDate).toBeNull();
    expect(byName(view, 'Nueva App').nextDate).toBe('2026-11-12');
    expect(byName(view, 'Gimnasio').nextDate).toBe('2026-10-30');
  });

  it('totals the monthly amounts, × 12 for the year, leaving out those without a frequency', async () => {
    const repo = await setup();
    await subscriptionRules(repo, ...concepts);
    await importFile(repo, movements);

    // 10 € + 13,99 € + 4,99 € (assumed monthly) + 10,99 €; the magazine doesn't count.
    expect((await repo.subscriptions()).totals).toMatchObject({ monthly: 3997, yearly: 47964 });
  });

  it("shows what the category spent this month, as Análisis → Gastos does, a refund included", async () => {
    const repo = await setup();
    await subscriptionRules(repo, ...concepts);
    await importFile(repo, [...movements, card('16/10/2026', 'Abono', 13.99, 'Devolucion netflix')]);
    const suscripciones = await categoryId(repo, 'Suscripciones');
    const refund = (await repo.listTransactions('2026-10')).find((tx) => tx.bankMovement === 'Devolucion netflix')!;
    await repo.updateTransaction(refund.id, { categoryId: suscripciones });

    const { totals } = await repo.subscriptions();
    // October: 119,99 € + 4,99 € + 13,99 € − the 13,99 € refund. September's charges and Mercadona don't count.
    expect(totals.spentThisMonth).toBe(12498);
    const gastos = (await repo.spending('2026-10')).entries.find((entry) => entry.category?.id === suscripciones);
    expect(gastos?.amount).toBe(totals.spentThisMonth);
  });

  it('flags a price rise when the last charge is higher than the one before', async () => {
    const repo = await setup();
    await subscriptionRules(repo, ...concepts, 'cine');
    await importFile(repo, [...movements, card('03/09/2026', 'Cine', -12), card('03/10/2026', 'Cine', -9)]);

    const view = await repo.subscriptions();
    const rising = view.subscriptions.filter((s) => s.priceRise).map((s) => s.payee.name);
    // Cheaper isn't a rise, and a single charge has nothing to compare with.
    expect(rising).toEqual(['Dominio Web', 'Netflix']);
  });

  it('flags a monthly subscription whose charge is expected this month and hasn’t arrived', async () => {
    const repo = await setup();
    await subscriptionRules(repo, ...concepts, 'hbo');
    // HBO was charged in September only: two months are needed for an expected charge.
    await importFile(repo, [...movements, card('25/09/2026', 'Hbo', -9.99)]);

    const view = await repo.subscriptions();
    expect(view.subscriptions.filter((s) => s.missingCharge).map((s) => s.payee.name)).toEqual(['Spotify']);
    // The same rule as the forecast's expected charges: HBO's single charge is assumed monthly, but not missing.
    expect(byName(view, 'Hbo')).toMatchObject({ frequency: 'monthly', assumed: true, missingCharge: false });

    // Once October's charge arrives, the notice goes.
    await importFile(repo, [card('19/10/2026', 'Spotify', -10.99)]);
    expect((await repo.subscriptions()).subscriptions.some((s) => s.missingCharge)).toBe(false);
  });

  it('counts only the payee’s expenses in "Suscripciones" as its charges', async () => {
    const repo = await setup();
    // The starter rule makes every Amazon order Compras, with the payee "Amazon".
    await importFile(repo, [card('10/09/2026', 'Www.amazon*prime', -49.9), card('12/10/2026', 'Www.amazon*nv14y8j34', -25)]);
    const prime = (await repo.listTransactions('2026-09'))[0];
    await repo.updateTransaction(prime.id, { categoryId: await categoryId(repo, 'Suscripciones') });

    const view = await repo.subscriptions();
    // October's order isn't a charge: Prime stays at 49,90 € with a single charge, assumed monthly.
    expect(view.subscriptions.map((s) => [s.payee.name, s.lastAmount, s.lastDate, s.frequency, s.assumed])).toEqual([['Amazon', 4990, '2026-09-10', 'monthly', true]]);
  });

  it('tells apart PayPal charges by the payee the rules give them', async () => {
    const repo = await setup();
    const suscripciones = await categoryId(repo, 'Suscripciones');
    await repo.createRule({ name: 'Mullvad', match: { value: 'mullvad' }, actions: { categoryId: suscripciones, payeeName: 'Mullvad' } });
    await repo.createRule({ name: 'Proton', match: { value: 'proton' }, actions: { categoryId: suscripciones, payeeName: 'Proton' } });
    await importFile(repo, [
      card('03/09/2026', 'Paypal', -5, 'Mullvad vpn'),
      card('08/09/2026', 'Paypal', -4.99, 'Proton ag'),
      card('03/10/2026', 'Paypal', -5, 'Mullvad vpn'),
      card('08/10/2026', 'Paypal', -4.99, 'Proton ag'),
    ]);

    const view = await repo.subscriptions();
    expect(rows(view)).toEqual([
      ['Mullvad', 'monthly', 500],
      ['Proton', 'monthly', 499],
    ]);
    expect(view.totals.monthly).toBe(999);
  });

  it('finds the category by name, ignoring case and accents', async () => {
    const repo = await setup();
    await subscriptionRules(repo, ...concepts);
    await importFile(repo, movements);
    await repo.updateCategory(await categoryId(repo, 'Suscripciones'), { name: 'SUSCRIPCIÓNES' });

    expect((await repo.subscriptions()).subscriptions).toHaveLength(5);
  });

  it('is empty without charges in "Suscripciones" or without the category', async () => {
    const repo = await setup();
    await importFile(repo, movements);
    const empty = { subscriptions: [], totals: { monthly: 0, yearly: 0, spentThisMonth: 0 } };
    expect(await repo.subscriptions()).toEqual(empty);

    await repo.deleteCategory(await categoryId(repo, 'Suscripciones'), null);
    expect(await repo.subscriptions()).toEqual(empty);
  });
});
