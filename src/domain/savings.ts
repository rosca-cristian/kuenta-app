import type { Cents } from './money';
import { addMonths, daysInMonth, monthOf, type IsoDate, type Month } from './dates';
import type { SavingsTarget } from './model';

/** A month that's over is *met* (✓) or *missed* (✗); the current one is still *en curso*. */
export type SavingsStatus = 'met' | 'missed' | 'inProgress';

/** How many months the history goes back, the month shown included. */
export const SAVINGS_HISTORY_MONTHS = 12;

/** One month against its target. */
export interface SavingsMonth {
  month: Month;
  /** The target in force that month: above 0. */
  target: Cents;
  /** The month's income − expenses, as Inicio's summary counts them: negative when more went out than came in. */
  saved: Cents;
  /** saved / target × 100, unrounded and above 100 past the target; 0 when the savings are negative. */
  percent: number;
  status: SavingsStatus;
  /** The savings are at or above the target: *Conseguido*, even while the month is under way. */
  reached: boolean;
}

/** Objetivos → Ahorro mensual for a month: the month against its target, its "today" marker, the history and the streak. */
export interface SavingsProgress extends SavingsMonth {
  /** Where the "today" marker sits, as a share of the month (day / days in month); null for other months. */
  today: number | null;
  /**
   * Newest first: the months with a target above 0 among the last `SAVINGS_HISTORY_MONTHS`
   * up to the month shown, none before the first month with data.
   */
  history: SavingsMonth[];
  /** Consecutive months met, ending at the month before the current one (at the month shown, once it's over): the month under way doesn't count. */
  streak: number;
}

/** The target in a month: the one with the latest starting month up to it, or 0 for none. */
export function targetFor(targets: SavingsTarget[], month: Month): Cents {
  let current: SavingsTarget | null = null;
  for (const target of targets) {
    if (target.fromMonth > month) continue;
    if (!current || target.fromMonth > current.fromMonth) current = target;
  }
  return current?.amount ?? 0;
}

/** A month with a target above 0 against it; the current month and later ones are in progress. */
export function savingsMonth(month: Month, target: Cents, saved: Cents, currentMonth: Month): SavingsMonth {
  const reached = saved >= target;
  const status = month >= currentMonth ? 'inProgress' : reached ? 'met' : 'missed';
  return { month, target, saved, percent: (Math.max(0, saved) * 100) / target, status, reached };
}

/**
 * A month's savings against its target, or null when it has none (0 or no target). `savings`
 * holds each month's savings, as Inicio's summary counts them (a month missing has saved 0),
 * and must cover the months the history and the streak look at, from `firstMonth` (the first
 * month with data; null without any) or the first target, whichever is later. Each month is
 * judged against the target it had, so changing the target never rewrites earlier months.
 */
export function savingsProgress({
  month,
  targets,
  savings,
  today,
  firstMonth,
}: {
  month: Month;
  targets: SavingsTarget[];
  savings: Map<Month, Cents>;
  today: IsoDate;
  firstMonth: Month | null;
}): SavingsProgress | null {
  const currentMonth = monthOf(today);
  const judged = (m: Month) => {
    const target = targetFor(targets, m);
    return target > 0 ? savingsMonth(m, target, savings.get(m) ?? 0, currentMonth) : null;
  };
  const shown = judged(month);
  if (!shown) return null;

  // Months with no data aren't failures: nothing before the first month with data counts.
  const hasData = (m: Month) => firstMonth !== null && m >= firstMonth;
  const history: SavingsMonth[] = [];
  for (let i = 0; i < SAVINGS_HISTORY_MONTHS; i++) {
    const entry = hasData(addMonths(month, -i)) ? judged(addMonths(month, -i)) : null;
    if (entry) history.push(entry);
  }

  // The month under way neither counts nor breaks it; a month without a target breaks it.
  let streak = 0;
  for (let m = shown.status === 'inProgress' ? addMonths(month, -1) : month; hasData(m); m = addMonths(m, -1)) {
    if (judged(m)?.status !== 'met') break;
    streak++;
  }

  return {
    ...shown,
    today: monthOf(today) === month ? Number(today.slice(8, 10)) / daysInMonth(month) : null,
    history,
    streak,
  };
}
