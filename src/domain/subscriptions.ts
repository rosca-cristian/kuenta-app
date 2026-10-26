import type { Cents } from './money';
import { addMonths, daysInMonth, monthOf, monthsBetween, type IsoDate, type Month } from './dates';
import { spendingByCategory } from './budgets';
import { expectedCharges } from './forecast';
import type { Id, Transaction } from './model';

/** How often a subscription charges, deduced from its last two charges (or assumed monthly from a single one). */
export type SubscriptionFrequency = 'monthly' | 'yearly';

/** A payee with expenses in the "Suscripciones" category, as its charges describe it. */
export interface Subscription {
  payeeId: Id;
  /** The amount of the latest charge. */
  lastAmount: Cents;
  lastDate: IsoDate;
  /** Monthly (assumed) for a single charge; null ("—") for two charges at irregular dates. */
  frequency: SubscriptionFrequency | null;
  /** The frequency is assumed monthly from a single charge, to be confirmed by the next one; false when deduced from two charges. */
  assumed: boolean;
  /** The last amount for monthly ones, a twelfth of it, rounded to the cent, for yearly ones; null ("—") otherwise. */
  monthlyAmount: Cents | null;
  /** The last charge's date plus a month or a year; null without a frequency. */
  nextDate: IsoDate | null;
  /** The last charge is higher than the one before. */
  priceRise: boolean;
  /** A monthly subscription that is an expected charge this month: charged the two months before and not yet in this one. */
  missingCharge: boolean;
}

export interface SubscriptionTotals {
  /** The sum of the monthly amounts; subscriptions without a frequency don't count. */
  monthly: Cents;
  /** The monthly total × 12. */
  yearly: Cents;
  /** The category's spending in the current month as budgets and Análisis → Gastos measure it: its expenses minus its income. */
  spentThisMonth: Cents;
}

/** Months apart that make a yearly subscription: about 12, a month either way. */
const YEARLY_MIN = 11;
const YEARLY_MAX = 13;

/** The same day `count` months later, or the month's last day when it's shorter (31 January → 28 February). */
function addMonthsToDate(date: IsoDate, count: number): IsoDate {
  const month = addMonths(monthOf(date), count);
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), daysInMonth(month))).padStart(2, '0')}`;
}

function frequencyOf(previous: IsoDate | undefined, last: IsoDate): SubscriptionFrequency | null {
  // A single charge: monthly until the next one says otherwise.
  if (previous === undefined) return 'monthly';
  // Two charges in the same month (0 apart) are irregular too.
  const apart = monthsBetween(monthOf(previous), monthOf(last));
  if (apart === 1) return 'monthly';
  return apart >= YEARLY_MIN && apart <= YEARLY_MAX ? 'yearly' : null;
}

/**
 * The subscriptions on `today`: one per payee with an imported expense in the subscriptions
 * category, whose charges are its expenses in that category. Transfers, balance adjustments
 * and transactions without a payee never count. `transactions` must hold every charge in the
 * category and, for the missing charges, every transaction of today's month and the two before.
 */
export function subscriptions(transactions: Transaction[], categoryId: Id, today: IsoDate): Subscription[] {
  const charges = new Map<Id, Transaction[]>();
  for (const tx of transactions) {
    if (tx.source !== 'import' || tx.type !== 'expense' || tx.categoryId !== categoryId || tx.payeeId === null) continue;
    charges.set(tx.payeeId, [...(charges.get(tx.payeeId) ?? []), tx]);
  }
  // The forecast's rule, on every expense of the payee.
  const expected = new Set(expectedCharges(transactions, monthOf(today)).map((charge) => charge.payeeId));

  return [...charges].map(([payeeId, txs]) => {
    const [last, previous] = [...txs].sort((a, b) => b.date.localeCompare(a.date));
    const frequency = frequencyOf(previous?.date, last.date);
    return {
      payeeId,
      lastAmount: last.amount,
      lastDate: last.date,
      frequency,
      assumed: previous === undefined,
      monthlyAmount: frequency === 'monthly' ? last.amount : frequency === 'yearly' ? Math.round(last.amount / 12) : null,
      nextDate: frequency === null ? null : addMonthsToDate(last.date, frequency === 'monthly' ? 1 : 12),
      priceRise: previous !== undefined && last.amount > previous.amount,
      missingCharge: frequency === 'monthly' && expected.has(payeeId),
    };
  });
}

/**
 * The totals of `list`, plus what the subscriptions category (`categoryId`) spent in `month`
 * by `transactions`, which must hold that month's transactions in the category.
 */
export function subscriptionTotals(list: Subscription[], transactions: Transaction[], categoryId: Id, month: Month): SubscriptionTotals {
  const monthly = list.reduce((sum, subscription) => sum + (subscription.monthlyAmount ?? 0), 0);
  return { monthly, yearly: monthly * 12, spentThisMonth: spendingByCategory(transactions, month).get(categoryId) ?? 0 };
}
