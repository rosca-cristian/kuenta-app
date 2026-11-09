import { describe, expect, it } from 'vitest';
import { cashAvailableOn, cashHeldOn, cashPocket, cashReminderDue, checkCashExpense, isWithdrawal, withCash, type CashWithdrawal } from './cash';
import type { CashExpense, Transaction } from './model';

const withdrawal = (id: string, date: string, amount: number): CashWithdrawal => ({ id, date, amount });

let created = 0;
const expense = (id: string, date: string, amount: number, categoryId = 'cat-bar'): CashExpense => {
  const stamp = `2026-11-01T10:00:${String(++created).padStart(2, '0')}.000Z`;
  return { id, amount, categoryId, date, note: '', createdAt: stamp, updatedAt: stamp };
};

/** 100 € on 1 October and 50 € on 10 October. */
const withdrawals = [withdrawal('w-2', '2026-10-10', 5000), withdrawal('w-1', '2026-10-01', 10000)];

describe('the cash pocket', () => {
  it('pays each expense from the oldest withdrawal with cash left', () => {
    const pocket = cashPocket(withdrawals, [expense('e-1', '2026-10-12', 3000)]);
    expect(pocket.parts.get('e-1')).toEqual([{ withdrawalId: 'w-1', amount: 3000 }]);
    expect(pocket.withdrawals.get('w-1')).toEqual({ spread: 3000, left: 7000, expenses: [{ id: 'e-1', amount: 3000 }] });
    expect(pocket.withdrawals.get('w-2')).toEqual({ spread: 0, left: 5000, expenses: [] });
    expect(pocket.left).toBe(12000);
  });

  it('spills over into the next withdrawal when the oldest runs out', () => {
    const pocket = cashPocket(withdrawals, [expense('e-1', '2026-10-05', 8000), expense('e-2', '2026-10-12', 4000)]);
    expect(pocket.parts.get('e-2')).toEqual([
      { withdrawalId: 'w-1', amount: 2000 },
      { withdrawalId: 'w-2', amount: 2000 },
    ]);
    expect(pocket.withdrawals.get('w-1')).toMatchObject({ spread: 10000, left: 0 });
    expect(pocket.withdrawals.get('w-2')).toEqual({ spread: 2000, left: 3000, expenses: [{ id: 'e-2', amount: 2000 }] });
    expect(pocket.left).toBe(3000);
    expect(pocket.uncovered.size).toBe(0);
  });

  it('pays expenses in date order, then in the order they were noted down', () => {
    // Noted down in reverse order: the 3 October one still goes first.
    const late = expense('e-late', '2026-10-12', 9000);
    const early = expense('e-early', '2026-10-03', 3000);
    const pocket = cashPocket(withdrawals, [late, early]);
    expect(pocket.parts.get('e-early')).toEqual([{ withdrawalId: 'w-1', amount: 3000 }]);
    expect(pocket.parts.get('e-late')).toEqual([
      { withdrawalId: 'w-1', amount: 7000 },
      { withdrawalId: 'w-2', amount: 2000 },
    ]);
  });

  it('never pays an expense from a later withdrawal: one larger than the cash held then is uncovered and takes nothing', () => {
    const pocket = cashPocket(withdrawals, [expense('e-1', '2026-10-05', 12000), expense('e-2', '2026-10-06', 4000)]);
    expect(pocket.uncovered).toEqual(new Set(['e-1']));
    expect(pocket.parts.has('e-1')).toBe(false);
    expect(pocket.parts.get('e-2')).toEqual([{ withdrawalId: 'w-1', amount: 4000 }]);
    expect(pocket.left).toBe(11000);
  });

  it('leaves expenses uncovered when their withdrawal goes away, and covers them again when it comes back', () => {
    const expenses = [expense('e-1', '2026-10-12', 6000)];
    expect(cashPocket([withdrawals[0]], expenses).uncovered).toEqual(new Set(['e-1']));
    expect(cashPocket(withdrawals, expenses).uncovered.size).toBe(0);
  });

  it('is empty without withdrawals', () => {
    expect(cashPocket([], [])).toMatchObject({ left: 0, uncovered: new Set() });
  });
});

describe('the cash held on a date', () => {
  const expenses = [expense('e-1', '2026-10-05', 8000), expense('e-2', '2026-10-20', 4000)];
  const pocket = cashPocket(withdrawals, expenses);

  it('is what was withdrawn up to that day minus what was spent up to it', () => {
    expect(cashHeldOn(pocket, withdrawals, expenses, '2026-09-30')).toBe(0);
    expect(cashHeldOn(pocket, withdrawals, expenses, '2026-10-01')).toBe(10000);
    expect(cashHeldOn(pocket, withdrawals, expenses, '2026-10-05')).toBe(2000);
    expect(cashHeldOn(pocket, withdrawals, expenses, '2026-10-10')).toBe(7000);
    expect(cashHeldOn(pocket, withdrawals, expenses, '2026-10-31')).toBe(3000);
  });

  it('can be spent only down to what later expenses still need', () => {
    // On the 6th there's 20 € in hand, and the 50 € coming on the 10th covers the 40 € spent on the 20th.
    expect(cashAvailableOn(pocket, withdrawals, expenses, '2026-10-06')).toBe(2000);
    // On the 12th there's 70 €, of which 40 € go on the 20th.
    expect(cashAvailableOn(pocket, withdrawals, expenses, '2026-10-12')).toBe(3000);
    expect(cashAvailableOn(pocket, withdrawals, expenses, '2026-09-30')).toBe(0);
  });

  it('leaves uncovered expenses out', () => {
    const withUncovered = [...expenses, expense('e-3', '2026-10-02', 50000)];
    const next = cashPocket(withdrawals, withUncovered);
    expect(cashHeldOn(next, withdrawals, withUncovered, '2026-10-31')).toBe(3000);
  });
});

describe('checking a cash expense', () => {
  const others = [expense('e-1', '2026-10-05', 8000), expense('e-2', '2026-10-20', 4000)];
  const before = cashPocket(withdrawals, others);

  it('accepts one the cash covers without leaving another without cash', () => {
    expect(checkCashExpense(withdrawals, others, expense('new', '2026-10-12', 3000), before)).toEqual({ ok: true });
  });

  it('refuses one larger than the cash held on its date', () => {
    expect(checkCashExpense(withdrawals, others, expense('new', '2026-10-06', 2500), before)).toEqual({ ok: false, available: 2000, later: false });
  });

  it('refuses one that would leave a later expense without cash', () => {
    // 70 € in hand on the 12th, but only 30 € spare once the 20th's 40 € are paid.
    expect(checkCashExpense(withdrawals, others, expense('new', '2026-10-12', 5000), before)).toEqual({ ok: false, available: 3000, later: true });
  });

  it('says the cash held on its date when that is what falls short, even if later expenses leave less to spare', () => {
    // 80 € held on the 3rd, of which only 20 € are spare once the 5th is paid.
    const atFirst = [expense('e-5', '2026-10-05', 6000)];
    expect(checkCashExpense(withdrawals, atFirst, expense('new', '2026-10-03', 12000), cashPocket(withdrawals, atFirst))).toEqual({
      ok: false,
      available: 10000,
      later: false,
    });
  });

  it('checks an edit against the others, leaving the expense itself out', () => {
    const edited = { ...others[0], amount: 10000 };
    expect(checkCashExpense(withdrawals, [others[1]], edited, before)).toEqual({ ok: true });
    expect(checkCashExpense(withdrawals, [others[1]], { ...others[0], amount: 10100 }, before)).toEqual({ ok: false, available: 10000, later: false });
  });

  it('lets an expense already without cash stay so, when the edit leaves the others as they were', () => {
    const uncovered = expense('e-3', '2026-10-02', 50000);
    const all = [...others, uncovered];
    const current = cashPocket(withdrawals, all);
    expect(checkCashExpense(withdrawals, others, { ...uncovered, note: 'Regalo' }, current)).toEqual({ ok: true });
  });
});

describe('a withdrawal', () => {
  const tx = (fields: Partial<Transaction>) =>
    ({ id: 't', type: 'expense', source: 'import', categoryId: 'cat-cash', date: '2026-10-01', amount: 1000, ...fields }) as Transaction;

  it('is an imported expense in the cash category on or after the start date', () => {
    expect(isWithdrawal(tx({}), 'cat-cash', '2026-10-01')).toBe(true);
    expect(isWithdrawal(tx({ date: '2026-09-30' }), 'cat-cash', '2026-10-01')).toBe(false);
    expect(isWithdrawal(tx({ categoryId: 'cat-bar' }), 'cat-cash', '2026-10-01')).toBe(false);
    expect(isWithdrawal(tx({ type: 'income' }), 'cat-cash', '2026-10-01')).toBe(false);
    expect(isWithdrawal(tx({ source: 'adjustment' }), 'cat-cash', '2026-10-01')).toBe(false);
    expect(isWithdrawal(tx({}), null, '2026-10-01')).toBe(false);
    expect(isWithdrawal(tx({}), 'cat-cash', null)).toBe(false);
  });
});

describe('the stats with cash', () => {
  const bank = (id: string, date: string, amount: number, categoryId: string) =>
    ({ id, type: 'expense', source: 'import', categoryId, date, amount, accountId: 'acc', payeeId: null }) as Transaction;
  const txs = [bank('w-1', '2026-10-01', 10000, 'cat-cash'), bank('old', '2026-09-20', 2000, 'cat-cash'), bank('shop', '2026-10-03', 1500, 'cat-shop')];
  const expenses = [expense('e-1', '2026-10-04', 3000), expense('e-2', '2026-10-05', 90000)];
  const pocket = cashPocket([withdrawal('w-1', '2026-10-01', 10000)], expenses);

  it('count withdrawals as 0 and each covered cash expense as an expense in its category and on its date', () => {
    const counted = withCash(txs, pocket, expenses);
    expect(counted.map((tx) => [tx.id, tx.amount, tx.categoryId, tx.date])).toEqual([
      ['w-1', 0, 'cat-cash', '2026-10-01'],
      ['old', 2000, 'cat-cash', '2026-09-20'],
      ['shop', 1500, 'cat-shop', '2026-10-03'],
      ['e-1', 3000, 'cat-bar', '2026-10-04'],
    ]);
    expect(counted[3]).toMatchObject({ type: 'expense', source: 'import', payeeId: null, toAccountId: null });
  });

  it('count only the cash expenses of a date range', () => {
    expect(withCash(txs, pocket, expenses, { from: '2026-11-01', to: '2026-11-30' }).map((tx) => tx.id)).toEqual(['w-1', 'old', 'shop']);
  });
});

describe("Inicio's cash reminder", () => {
  it('shows 3 days after the latest withdrawal, cash expense or "Más tarde", while there is cash left', () => {
    expect(cashReminderDue(5000, ['2026-10-10', null, null], '2026-10-12')).toBe(false);
    expect(cashReminderDue(5000, ['2026-10-10', null, null], '2026-10-13')).toBe(true);
    expect(cashReminderDue(5000, ['2026-10-10', '2026-10-12', null], '2026-10-14')).toBe(false);
    expect(cashReminderDue(5000, ['2026-10-10', '2026-10-12', '2026-10-14'], '2026-10-16')).toBe(false);
    expect(cashReminderDue(5000, ['2026-10-10', '2026-10-12', '2026-10-14'], '2026-10-17')).toBe(true);
    expect(cashReminderDue(0, ['2026-10-01', null, null], '2026-10-20')).toBe(false);
    expect(cashReminderDue(5000, [null, null, null], '2026-10-20')).toBe(false);
  });
});
