import { describe, expect, it } from 'vitest';
import { allocateReimbursement, leftToPayBack, netOfReimbursements } from './reimbursements';
import { monthSpending, monthSummary } from './stats';
import { budgetMonth } from './budgets';
import type { Reimbursement, Transaction } from './model';

const stamp = '2026-10-01T00:00:00.000Z';

function tx(id: string, date: string, type: Transaction['type'], amount: number, extra: Partial<Transaction> = {}): Transaction {
  return {
    id, type, amount, date, accountId: 'bbva', toAccountId: null, categoryId: null, payeeId: null, note: '',
    source: 'import', importBatchId: null, importHash: null, bookingDate: date, bankConcept: null, bankMovement: null,
    bankBalance: null, editedAt: null, createdAt: stamp, updatedAt: stamp, ...extra,
  };
}

let linkCount = 0;
const link = (incomeId: string, expenseId: string, amount: number): Reimbursement => ({ id: `link-${++linkCount}`, incomeId, expenseId, amount });

const amounts = (txs: Transaction[]) => Object.fromEntries(txs.map((t) => [t.id, t.amount]));

describe('allocating an income over the ticked expenses', () => {
  it('fills them oldest first, by date then id, each up to what is left of it and of the income', () => {
    const expenses = [
      { id: 'b', date: '2026-10-05', left: 3000 },
      { id: 'c', date: '2026-10-01', left: 2000 },
      { id: 'a', date: '2026-10-05', left: 1000 },
    ];
    expect(allocateReimbursement(4500, expenses)).toEqual({ parts: { c: 2000, a: 1000, b: 1500 }, remainder: 0 });
  });

  it('returns what stays as income when the expenses take less than all of it', () => {
    expect(allocateReimbursement(5000, [{ id: 'a', date: '2026-10-01', left: 1200 }])).toEqual({ parts: { a: 1200 }, remainder: 3800 });
  });

  it('gives 0 to the expenses the income no longer reaches', () => {
    const expenses = [
      { id: 'a', date: '2026-10-01', left: 3000 },
      { id: 'b', date: '2026-10-02', left: 3000 },
    ];
    expect(allocateReimbursement(2000, expenses)).toEqual({ parts: { a: 2000, b: 0 }, remainder: 0 });
  });

  it('keeps the parts typed by hand and spreads only what is left after them', () => {
    const expenses = [
      { id: 'a', date: '2026-10-01', left: 3000 },
      { id: 'b', date: '2026-10-02', left: 3000 },
    ];
    expect(allocateReimbursement(4000, expenses, { b: 2500 })).toEqual({ parts: { a: 1500, b: 2500 }, remainder: 0 });
    // Typed parts beyond the income leave nothing for the others, and a negative remainder.
    expect(allocateReimbursement(2000, expenses, { b: 2500 })).toEqual({ parts: { a: 0, b: 2500 }, remainder: -500 });
  });
});

describe('what is left of an expense to pay back', () => {
  it('counts every income but the one being edited', () => {
    const links = [link('in-1', 'dinner', 1000), link('in-2', 'dinner', 500), link('in-1', 'other', 300)];
    expect(leftToPayBack({ id: 'dinner', amount: 4000 }, links)).toBe(2500);
    expect(leftToPayBack({ id: 'dinner', amount: 4000 }, links, 'in-1')).toBe(3500);
  });
});

describe('netting the reimbursements out of income and spending', () => {
  it('leaves your part of a dinner three friends paid back with Bizum, and none of the Bizum as income', () => {
    const restaurantes = 'restaurantes';
    const txs = [
      tx('romera', '2026-10-10', 'expense', 7350, { categoryId: restaurantes }),
      tx('ana', '2026-10-10', 'income', 3805),
      tx('luis', '2026-10-11', 'income', 985),
      tx('eva', '2026-10-12', 'income', 1565),
      tx('nomina', '2026-10-01', 'income', 150000),
    ];
    const links = [link('ana', 'romera', 3805), link('luis', 'romera', 985), link('eva', 'romera', 1565)];
    const netted = netOfReimbursements(txs, links);

    expect(amounts(netted)).toEqual({ romera: 995, ana: 0, luis: 0, eva: 0, nomina: 150000 });
    expect(monthSummary(netted, '2026-10')).toMatchObject({ income: 150000, expenses: 995, savings: 149005 });
    expect(monthSpending(netted, '2026-10', [restaurantes])).toMatchObject({ entries: [{ categoryId: restaurantes, amount: 995 }], total: 995 });
    // The originals stay as the bank has them.
    expect(txs[0].amount).toBe(7350);
  });

  it("spreads one transfer from the parents over two days' expenses in two categories", () => {
    const txs = [
      tx('super', '2026-10-03', 'expense', 6000, { categoryId: 'supermercado' }),
      tx('farmacia', '2026-10-04', 'expense', 2500, { categoryId: 'salud' }),
      tx('padres', '2026-10-05', 'income', 8000),
    ];
    const netted = netOfReimbursements(txs, [link('padres', 'super', 6000), link('padres', 'farmacia', 2000)]);

    expect(amounts(netted)).toEqual({ super: 0, farmacia: 500, padres: 0 });
    expect(monthSummary(netted, '2026-10')).toMatchObject({ income: 0, expenses: 500, savingsRate: null });
    expect(monthSpending(netted, '2026-10', ['supermercado', 'salud'])).toMatchObject({ entries: [{ categoryId: 'salud', amount: 500 }], total: 500 });
  });

  it('keeps as income what an income spreads only part of', () => {
    const txs = [tx('compra', '2026-10-03', 'expense', 3000, { categoryId: 'compras' }), tx('bizum', '2026-10-04', 'income', 5000)];
    const netted = netOfReimbursements(txs, [link('bizum', 'compra', 3000)]);

    expect(amounts(netted)).toEqual({ compra: 0, bizum: 2000 });
    expect(monthSummary(netted, '2026-10')).toMatchObject({ income: 2000, expenses: 0, savings: 2000, savingsRate: 1 });
  });

  it("counts an expense paid back the next month in the expense's month, and the income nowhere", () => {
    const restaurantes = 'restaurantes';
    const txs = [
      tx('cena', '2026-09-28', 'expense', 10000, { categoryId: restaurantes }),
      tx('bizum', '2026-10-02', 'income', 6000),
      tx('glovo', '2026-10-03', 'expense', 2000, { categoryId: restaurantes }),
    ];
    const netted = netOfReimbursements(txs, [link('bizum', 'cena', 6000)]);

    expect(monthSummary(netted, '2026-09')).toMatchObject({ income: 0, expenses: 4000 });
    expect(monthSummary(netted, '2026-10')).toMatchObject({ income: 0, expenses: 2000 });
    expect(monthSpending(netted, '2026-09', [restaurantes]).total).toBe(4000);
    expect(monthSpending(netted, '2026-10', [restaurantes]).total).toBe(2000);
    const limits = [{ id: 'l', categoryId: restaurantes, fromMonth: '2026-09', amount: 5000 }];
    const budget = (month: string) => budgetMonth({ month, categoryIds: [restaurantes], limits, transactions: netted, today: '2026-10-20' }).budgets[0].spent;
    expect(budget('2026-09')).toBe(4000);
    expect(budget('2026-10')).toBe(2000);

    // Each month loaded on its own still sees the link whose other side is in the other month.
    expect(monthSummary(netOfReimbursements([txs[0]], [link('bizum', 'cena', 6000)]), '2026-09').expenses).toBe(4000);
    expect(monthSummary(netOfReimbursements(txs.slice(1), [link('bizum', 'cena', 6000)]), '2026-10').income).toBe(0);
  });

  it('applies a link only to an expense as expense and an income as income, and leaves the rest alone', () => {
    const txs = [
      tx('a', '2026-10-01', 'transfer', 3000, { toAccountId: 'revolut' }),
      tx('b', '2026-10-02', 'income', 3000),
      tx('c', '2026-10-03', 'expense', 1000),
    ];
    // 'a' was an expense when it was linked, and has become a transfer since.
    const netted = netOfReimbursements(txs, [link('b', 'a', 1000)]);
    expect(amounts(netted)).toEqual({ a: 3000, b: 2000, c: 1000 });
    expect(netted[2]).toBe(txs[2]);
  });
});
