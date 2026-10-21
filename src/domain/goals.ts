import type { Cents } from './money';

/** How far a goal is: its account's balance against its target. */
export interface GoalProgress {
  /** The linked account's current balance: negative when it's overdrawn. */
  current: Cents;
  /** current / target × 100, unrounded and above 100 past the target; 0 while the balance is negative. */
  percent: number;
  /** The balance is at or above the target: *Conseguido*. */
  reached: boolean;
}

/** A goal's progress, given its target (above 0) and its account's balance today. */
export function goalProgress(target: Cents, balance: Cents): GoalProgress {
  return { current: balance, percent: (Math.max(0, balance) * 100) / target, reached: balance >= target };
}
