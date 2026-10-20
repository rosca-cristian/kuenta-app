import type { Cents } from './money';
import type { IsoDate } from './dates';

/**
 * A link in the bank's running-balance chain: an imported transaction seen from
 * the import account, with the bank's sign and the "Disponible" after it.
 */
export interface ChainLink {
  bookingDate: IsoDate;
  /** Signed as in the bank file. */
  amount: Cents;
  balance: Cents;
}

export interface Gap {
  /** Booking date of the last transaction before the gap. */
  after: IsoDate;
  /** Booking date of the first transaction after the gap. */
  before: IsoDate;
}

const balanceBefore = (link: ChainLink) => link.balance - link.amount;

/** Orders one booking day by following the balance chain from the previous day's last balance. */
function orderDay<T extends ChainLink>(links: T[], previous: Cents | null): T[] {
  const remaining = [...links];
  const ordered: T[] = [];
  let current = previous;
  while (remaining.length > 0) {
    let index = current === null ? -1 : remaining.findIndex((link) => balanceBefore(link) === current);
    if (index < 0) {
      // Start from a link that no other link of the day leads into.
      index = remaining.findIndex(
        (link) => !remaining.some((other) => other !== link && other.balance === balanceBefore(link)),
      );
    }
    if (index < 0) index = 0;
    const [next] = remaining.splice(index, 1);
    ordered.push(next);
    current = next.balance;
  }
  return ordered;
}

/**
 * Puts imported transactions in bank order: by booking date and, within a day,
 * by reconstructing the chain of balances. Links that share a day and can't be
 * told apart keep their relative input order.
 */
export function bankOrder<T extends ChainLink>(links: T[]): T[] {
  const byDay = new Map<IsoDate, T[]>();
  for (const link of links) {
    const day = byDay.get(link.bookingDate);
    if (day) day.push(link);
    else byDay.set(link.bookingDate, [link]);
  }
  const ordered: T[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const previous = ordered.length > 0 ? ordered[ordered.length - 1].balance : null;
    ordered.push(...orderDay(byDay.get(day)!, previous));
  }
  return ordered;
}

/** Places where consecutive transactions in bank order don't chain: rows are missing there. */
export function findGaps(ordered: ChainLink[]): Gap[] {
  const gaps: Gap[] = [];
  for (let i = 1; i < ordered.length; i++) {
    if (balanceBefore(ordered[i]) !== ordered[i - 1].balance) {
      gaps.push({ after: ordered[i - 1].bookingDate, before: ordered[i].bookingDate });
    }
  }
  return gaps;
}

/** The balance before the first transaction in bank order. */
export function openingBalanceOf(ordered: ChainLink[]): Cents | null {
  return ordered.length > 0 ? balanceBefore(ordered[0]) : null;
}

/** The most recent "Disponible" in bank order. */
export function latestBalanceOf(ordered: ChainLink[]): Cents | null {
  return ordered.length > 0 ? ordered[ordered.length - 1].balance : null;
}
