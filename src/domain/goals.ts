import type { Cents } from './money';
import { monthsBetween, type Month } from './dates';

/**
 * What an unreached goal with a target month asks for: how much to save each month to get
 * there (`save`), or, once that month has passed, how much is still missing (`overdue`).
 */
export type GoalPlan =
  | {
      kind: 'save';
      /** Target month − current month, at least 1: a goal for the current month has this month left. */
      monthsLeft: number;
      /** (target − current) / months left, rounded up to the cent: "ahorra X €/mes". */
      perMonth: Cents;
    }
  | {
      kind: 'overdue';
      /** target − current: "Fecha superada · faltan X €". */
      missing: Cents;
    };

/** How far a goal is: its account's balance against its target. */
export interface GoalProgress {
  /** The linked account's current balance: negative when it's overdrawn. */
  current: Cents;
  /** current / target × 100, unrounded and above 100 past the target; 0 while the balance is negative. */
  percent: number;
  /** The balance is at or above the target: *Conseguido*. */
  reached: boolean;
  /** Null without a target month and once reached: there's no monthly amount then. */
  plan: GoalPlan | null;
}

/**
 * A goal's progress, given its target (above 0), its account's balance today, its target
 * month (any month, past ones included) and the current month.
 */
export function goalProgress(target: Cents, balance: Cents, targetMonth: Month | null, currentMonth: Month): GoalProgress {
  const reached = balance >= target;
  const plan = reached || targetMonth === null ? null : goalPlan(target - balance, monthsBetween(currentMonth, targetMonth));
  return { current: balance, percent: (Math.max(0, balance) * 100) / target, reached, plan };
}

function goalPlan(missing: Cents, months: number): GoalPlan {
  if (months < 0) return { kind: 'overdue', missing };
  const monthsLeft = Math.max(1, months);
  return { kind: 'save', monthsLeft, perMonth: Math.ceil(missing / monthsLeft) };
}
