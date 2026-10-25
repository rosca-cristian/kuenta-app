import { describe, expect, it } from 'vitest';
import { netWorthSeries } from './balances';
import type { Account, Transaction } from './model';

const stamp = '2026-10-01T00:00:00.000Z';

function account(id: string, openingBalance: number, archived = false): Account {
  return { id, name: id, type: 'bank', openingBalance, color: 'blue', icon: 'landmark', archived, order: 0, createdAt: stamp, updatedAt: stamp };
}

function tx(date: string, type: Transaction['type'], amount: number, accountId: string, extra: Partial<Transaction> = {}): Transaction {
  return {
    id: `${date}-${type}-${amount}`, type, amount, date, accountId, toAccountId: null, categoryId: null, payeeId: null, note: '',
    source: 'import', importBatchId: null, importHash: null, bookingDate: date, bankConcept: null, bankMovement: null,
    bankBalance: null, editedAt: null, createdAt: stamp, updatedAt: stamp, ...extra,
  };
}

const series = (...args: Parameters<typeof netWorthSeries>) => netWorthSeries(...args).map((p) => [p.month, p.date, p.netWorth]);

describe('the net worth series', () => {
  it('is empty without transactions, whatever the opening balances', () => {
    expect(netWorthSeries([account('bbva', 100000)], [], '2026-10-20')).toEqual([]);
  });

  it("sums every account's balance on each month's last day, today's for the current month, from the first transaction's month", () => {
    const accounts = [account('bbva', 200000), account('hucha', 5000, true)];
    const txs = [
      tx('2026-08-10', 'expense', 10000, 'bbva'),
      tx('2026-09-15', 'income', 50000, 'bbva'),
      tx('2026-10-05', 'expense', 5000, 'bbva'),
      // After today: not in the current month's point yet.
      tx('2026-10-25', 'expense', 1000, 'bbva'),
    ];
    expect(series(accounts, txs, '2026-10-20')).toEqual([
      ['2026-08', '2026-08-31', 195000],
      ['2026-09', '2026-09-30', 245000],
      ['2026-10', '2026-10-20', 240000],
    ]);
  });

  it("isn't changed by transfers between the accounts, but is by balance adjustments", () => {
    const accounts = [account('bbva', 100000), account('revolut', 0)];
    const txs = [
      tx('2026-10-02', 'transfer', 20000, 'bbva', { toAccountId: 'revolut' }),
      tx('2026-10-03', 'expense', 2000, 'revolut', { source: 'adjustment' }),
    ];
    expect(series(accounts, txs, '2026-10-20')).toEqual([['2026-10', '2026-10-20', 98000]]);
  });

  it('covers the last `count` months only', () => {
    const txs = [tx('2025-01-10', 'income', 100, 'bbva'), tx('2026-10-01', 'income', 100, 'bbva')];
    const points = netWorthSeries([account('bbva', 0)], txs, '2026-10-20');
    expect(points.map((p) => p.month)).toEqual([
      '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
    ]);
    expect(points[0].netWorth).toBe(100);
    expect(points.at(-1)!.netWorth).toBe(200);
    expect(netWorthSeries([account('bbva', 0)], txs, '2026-10-20', 2).map((p) => p.month)).toEqual(['2026-09', '2026-10']);
  });
});
