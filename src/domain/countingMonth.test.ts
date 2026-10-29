import { describe, expect, it } from 'vitest';
import { countingMonthOf, inCountingMonths, isNextMonthDay } from './countingMonth';
import { netOfReimbursements } from './reimbursements';
import { monthSummary } from './stats';
import type { Category, Transaction } from './model';

const stamp = '2026-10-01T00:00:00.000Z';

function tx(id: string, date: string, type: Transaction['type'], amount: number, extra: Partial<Transaction> = {}): Transaction {
  return {
    id, type, amount, date, accountId: 'bbva', toAccountId: null, categoryId: 'nomina', payeeId: null, note: '',
    source: 'import', importBatchId: null, importHash: null, bookingDate: date, bankConcept: null, bankMovement: null,
    bankBalance: null, editedAt: null, createdAt: stamp, updatedAt: stamp, ...extra,
  };
}

const category = (id: string, kind: Category['kind'], nextMonthFromDay: number | null): Category => ({
  id, name: id, kind, icon: 'briefcase', color: 'green', order: 0, archived: false, nextMonthFromDay,
});

/** Nómina counts from the 25th in the next month; Supermercado, an expense category, has the day set too, which never counts. */
const categories = (nominaDay: number | null = 25) =>
  new Map([category('nomina', 'income', nominaDay), category('super', 'expense', 25), category('otros', 'income', null)].map((c) => [c.id, c]));

const countsIn = (date: string, extra: Partial<Transaction> = {}, nominaDay: number | null = 25) =>
  countingMonthOf(tx('a', date, 'income', 150000, extra), categories(nominaDay));

describe('the month an income counts in', () => {
  it('is the next one when it arrives on the day set or later, and its own before it', () => {
    expect(countsIn('2026-10-25')).toBe('2026-11');
    expect(countsIn('2026-10-29')).toBe('2026-11');
    expect(countsIn('2026-10-31')).toBe('2026-11');
    expect(countsIn('2026-10-24')).toBe('2026-10');
    // The salary paid on the 1st or 2nd is already in its month.
    expect(countsIn('2026-11-01')).toBe('2026-11');
    expect(countsIn('2026-11-02')).toBe('2026-11');
  });

  it('goes from December to January of the next year', () => {
    expect(countsIn('2026-12-30')).toBe('2027-01');
  });

  it('takes a day past the end of a short month as its last day', () => {
    // "A partir del día 31": the 30th in a 30-day month, the 28th in February, the 29th in a leap year's.
    expect(countsIn('2026-11-30', {}, 31)).toBe('2026-12');
    expect(countsIn('2026-11-29', {}, 31)).toBe('2026-11');
    expect(countsIn('2027-02-28', {}, 30)).toBe('2027-03');
    expect(countsIn('2027-02-27', {}, 30)).toBe('2027-02');
    expect(countsIn('2028-02-28', {}, 31)).toBe('2028-02');
    expect(countsIn('2028-02-29', {}, 31)).toBe('2028-03');
  });

  it('is always its own month without the setting', () => {
    expect(countsIn('2026-10-29', {}, null)).toBe('2026-10');
    expect(countsIn('2026-10-29', { categoryId: 'otros' })).toBe('2026-10');
    expect(countsIn('2026-10-29', { categoryId: null })).toBe('2026-10');
    expect(countsIn('2026-10-29', { categoryId: 'deleted' })).toBe('2026-10');
  });

  it("is always its own month for expenses, transfers and balance adjustments, and in an expense category's", () => {
    const byId = categories();
    expect(countingMonthOf(tx('a', '2026-10-29', 'expense', 5000), byId)).toBe('2026-10');
    expect(countingMonthOf(tx('a', '2026-10-29', 'transfer', 5000, { categoryId: null }), byId)).toBe('2026-10');
    expect(countingMonthOf(tx('a', '2026-10-29', 'income', 5000, { source: 'adjustment' }), byId)).toBe('2026-10');
    expect(countingMonthOf(tx('a', '2026-10-29', 'income', 5000, { categoryId: 'super' }), byId)).toBe('2026-10');
  });
});

describe('the transactions in their counting months', () => {
  it('dates a late income the first day of the month it counts in, leaving the others untouched', () => {
    const txs = [tx('salary', '2026-10-29', 'income', 150000), tx('shop', '2026-10-29', 'expense', 5000), tx('early', '2026-10-02', 'income', 1000)];
    const counted = inCountingMonths(txs, categories());
    expect(counted.map((t) => t.date)).toEqual(['2026-11-01', '2026-10-29', '2026-10-02']);
    expect(counted[1]).toBe(txs[1]);
    expect(txs[0].date).toBe('2026-10-29');
    expect(monthSummary(counted, '2026-10')).toMatchObject({ income: 1000, expenses: 5000 });
    expect(monthSummary(counted, '2026-11')).toMatchObject({ income: 150000, expenses: 0 });
  });

  it('counts what an income keeps after its reimbursements in its counting month', () => {
    const txs = [tx('salary', '2026-10-29', 'income', 150000), tx('dinner', '2026-10-28', 'expense', 6000, { categoryId: 'super' })];
    const counted = inCountingMonths(netOfReimbursements(txs, [{ id: 'l', incomeId: 'salary', expenseId: 'dinner', amount: 2000 }]), categories());
    expect(monthSummary(counted, '2026-10')).toMatchObject({ income: 0, expenses: 4000 });
    expect(monthSummary(counted, '2026-11')).toMatchObject({ income: 148000, expenses: 0 });
  });
});

describe('the day "A partir del día" accepts', () => {
  it('is a whole number from 1 to 31', () => {
    expect([1, 25, 31].every(isNextMonthDay)).toBe(true);
    expect([0, 32, 2.5, Number.NaN, -1].some(isNextMonthDay)).toBe(false);
  });
});
