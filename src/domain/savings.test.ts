import { describe, expect, it } from 'vitest';
import { savingsProgress, targetFor } from './savings';
import type { SavingsTarget } from './model';

let targetCount = 0;
const target = (fromMonth: string, amount: number): SavingsTarget => ({ id: `target-${++targetCount}`, fromMonth, amount });

/** 300 € a month from June 2026. */
const targets = [target('2026-06', 30000)];

/** Tuesday 20 October 2026, with data from June. */
const progress = (savings: [string, number][], options: { month?: string; targets?: SavingsTarget[]; today?: string; firstMonth?: string | null } = {}) =>
  savingsProgress({
    month: options.month ?? '2026-10',
    targets: options.targets ?? targets,
    savings: new Map(savings),
    today: options.today ?? '2026-10-20',
    firstMonth: options.firstMonth === undefined ? '2026-06' : options.firstMonth,
  });

const marks = (view: ReturnType<typeof progress>) => view?.history.map((entry) => [entry.month, entry.target, entry.saved, entry.status]);

describe('the target of a month', () => {
  it('is the one with the latest starting month up to it, 0 before the first and once removed', () => {
    const changes = [target('2026-09', 25000), target('2026-06', 30000), target('2026-11', 0)];
    expect(targetFor(changes, '2026-05')).toBe(0);
    expect(targetFor(changes, '2026-06')).toBe(30000);
    expect(targetFor(changes, '2026-08')).toBe(30000);
    expect(targetFor(changes, '2026-10')).toBe(25000);
    expect(targetFor(changes, '2027-03')).toBe(0);
    expect(targetFor([], '2026-10')).toBe(0);
  });
});

describe('a month against its target', () => {
  it('is in progress in the current month, reached once the savings get to the target', () => {
    expect(progress([['2026-10', 18000]])).toMatchObject({ month: '2026-10', target: 30000, saved: 18000, percent: 60, status: 'inProgress', reached: false });
    expect(progress([['2026-10', 30000]])).toMatchObject({ percent: 100, status: 'inProgress', reached: true });
    expect(progress([['2026-10', 45000]])).toMatchObject({ percent: 150, reached: true });
  });

  it('is met or missed once it is over', () => {
    expect(progress([['2026-09', 30000]], { month: '2026-09' })).toMatchObject({ status: 'met', reached: true });
    expect(progress([['2026-09', 29999]], { month: '2026-09' })).toMatchObject({ status: 'missed', reached: false });
  });

  it('shows 0 % for a negative month, which is missed', () => {
    expect(progress([['2026-10', -5000]])).toMatchObject({ saved: -5000, percent: 0, reached: false });
    expect(progress([['2026-09', -5000]], { month: '2026-09' })).toMatchObject({ percent: 0, status: 'missed' });
  });

  it('has no target before the first one, nor from a month it was removed in', () => {
    expect(progress([], { month: '2026-05' })).toBeNull();
    expect(progress([], { targets: [...targets, target('2026-10', 0)] })).toBeNull();
    expect(progress([], { targets: [] })).toBeNull();
  });

  it('counts a month without data as nothing saved', () => {
    expect(progress([])).toMatchObject({ saved: 0, percent: 0, reached: false });
  });
});

describe('the "today" marker', () => {
  it("sits at today's share of the current month, and nowhere in other months", () => {
    expect(progress([])!.today).toBe(20 / 31);
    expect(progress([], { today: '2026-11-15', month: '2026-11' })!.today).toBe(0.5);
    expect(progress([], { month: '2026-09' })!.today).toBeNull();
  });
});

describe('the history', () => {
  it('lists the months with a target newest first, the current one in progress', () => {
    const view = progress([
      ['2026-06', 31000],
      ['2026-07', 12000],
      ['2026-08', 30000],
      ['2026-09', -2000],
      ['2026-10', 5000],
    ]);
    expect(marks(view)).toEqual([
      ['2026-10', 30000, 5000, 'inProgress'],
      ['2026-09', 30000, -2000, 'missed'],
      ['2026-08', 30000, 30000, 'met'],
      ['2026-07', 30000, 12000, 'missed'],
      ['2026-06', 30000, 31000, 'met'],
    ]);
  });

  it('judges each month against the target it had, after a change and a removal', () => {
    const changes = [target('2026-06', 30000), target('2026-08', 0), target('2026-09', 20000)];
    const view = progress(
      [
        ['2026-06', 25000],
        ['2026-07', 35000],
        ['2026-08', 50000],
        ['2026-09', 25000],
      ],
      { targets: changes },
    );
    // August had none: it's left out, and the old 300 € still judge June and July.
    expect(marks(view)).toEqual([
      ['2026-10', 20000, 0, 'inProgress'],
      ['2026-09', 20000, 25000, 'met'],
      ['2026-07', 30000, 35000, 'met'],
      ['2026-06', 30000, 25000, 'missed'],
    ]);
  });

  it('goes back 12 months at most, the month shown included', () => {
    const view = progress([], { targets: [target('2024-01', 10000)], firstMonth: '2024-01' });
    expect(view!.history.map((entry) => entry.month)).toEqual([
      '2026-10', '2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01', '2025-12', '2025-11',
    ]);
  });

  it('starts at the first month with data, and is empty without any', () => {
    const view = progress([['2026-09', 40000]], { targets: [target('2026-01', 30000)], firstMonth: '2026-09' });
    expect(marks(view)).toEqual([
      ['2026-10', 30000, 0, 'inProgress'],
      ['2026-09', 30000, 40000, 'met'],
    ]);
    expect(progress([], { firstMonth: null })!.history).toEqual([]);
  });
});

describe('the streak', () => {
  it('counts the months met in a row before the current one, which never counts', () => {
    const met: [string, number][] = [
      ['2026-06', 10000],
      ['2026-07', 30000],
      ['2026-08', 31000],
      ['2026-09', 30000],
      ['2026-10', 99000],
    ];
    expect(progress(met)!.streak).toBe(3);
    expect(progress([['2026-10', 99000]])!.streak).toBe(0);
  });

  it('is broken by a missed month, and by a month without a target', () => {
    expect(progress([['2026-07', 30000], ['2026-08', 30000], ['2026-09', 1000]])!.streak).toBe(0);
    const changes = [target('2026-06', 30000), target('2026-08', 0), target('2026-09', 30000)];
    expect(progress([['2026-06', 30000], ['2026-07', 30000], ['2026-09', 30000]], { targets: changes })!.streak).toBe(1);
  });

  it('stops at the first month with data, and goes back further than the history', () => {
    const allMet = Array.from({ length: 22 }, (_, i): [string, number] => [`${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, 30000]);
    expect(progress(allMet, { targets: [target('2025-01', 30000)], firstMonth: '2025-01' })!.streak).toBe(21);
    expect(progress(allMet, { targets: [target('2025-01', 30000)], firstMonth: '2026-08' })!.streak).toBe(2);
  });

  it('ends at the month shown once that month is over', () => {
    expect(progress([['2026-08', 30000], ['2026-09', 30000]], { month: '2026-09' })!.streak).toBe(2);
  });
});
