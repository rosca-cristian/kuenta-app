import type { Cents } from './money';
import { daysBetween, type IsoDate } from './dates';
import { normalizeText } from './text';
import type { CashExpense, Category, Id, Transaction } from './model';

/** The expense category whose imported expenses are cash withdrawals, by normalized name: it survives being recreated or seeded again. */
export const cashCategoryOf = (categories: Category[]): Category | undefined =>
  categories.find((category) => category.kind === 'expense' && normalizeText(category.name) === 'efectivo');

/**
 * Whether a transaction is a cash withdrawal: an imported expense in the cash category dated on
 * or after the day Kuenta counts cash from. Earlier ones count as spent, as they always did.
 */
export const isWithdrawal = (tx: Pick<Transaction, 'type' | 'source' | 'categoryId' | 'date'>, cashCategoryId: Id | null, cashFromDate: IsoDate | null) =>
  cashCategoryId !== null && cashFromDate !== null && tx.source === 'import' && tx.type === 'expense' && tx.categoryId === cashCategoryId && tx.date >= cashFromDate;

/** A withdrawal as the pocket sees it: the cash it put in, on its date. */
export type CashWithdrawal = Pick<Transaction, 'id' | 'date' | 'amount'>;

/** One part of a cash expense paid from one withdrawal. */
export interface CashPart {
  withdrawalId: Id;
  amount: Cents;
}

/** A withdrawal's cash: how much of it cash expenses took, what's left, and the expenses with their part, oldest first. */
export interface WithdrawalCash {
  spread: Cents;
  left: Cents;
  expenses: { id: Id; amount: Cents }[];
}

export interface CashPocket {
  /** Each covered expense's parts, oldest withdrawal first. */
  parts: Map<Id, CashPart[]>;
  /** The expenses the cash held on their date can't pay whole ("Sin efectivo"): they take nothing and count nowhere. */
  uncovered: Set<Id>;
  /** Every withdrawal's cash, by id. */
  withdrawals: Map<Id, WithdrawalCash>;
  /** The unspent cash of every withdrawal. */
  left: Cents;
}

const byDate = <T extends { date: IsoDate; id: Id }>(a: T, b: T) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
/** The order expenses are paid in: by date, then in the order they were noted down. */
const paymentOrder = (a: CashExpense, b: CashExpense) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * Pays the cash expenses from the withdrawals. In date order, then in the order they were noted
 * down, each expense takes from the oldest withdrawal with cash left that isn't later than it,
 * spilling over into the next one. One the cash held on its date can't pay whole is uncovered
 * and takes nothing, so the pocket never goes negative.
 */
export function cashPocket(withdrawals: CashWithdrawal[], expenses: CashExpense[]): CashPocket {
  const ordered = [...withdrawals].sort(byDate);
  const left = new Map(ordered.map((w) => [w.id, w.amount]));
  const own = new Map<Id, { id: Id; amount: Cents }[]>(ordered.map((w) => [w.id, []]));
  const parts = new Map<Id, CashPart[]>();
  const uncovered = new Set<Id>();
  for (const expense of [...expenses].sort(paymentOrder)) {
    const eligible = ordered.filter((w) => w.date <= expense.date && left.get(w.id)! > 0);
    if (eligible.reduce((sum, w) => sum + left.get(w.id)!, 0) < expense.amount) {
      uncovered.add(expense.id);
      continue;
    }
    const paid: CashPart[] = [];
    let due = expense.amount;
    for (const w of eligible) {
      if (due === 0) break;
      const part = Math.min(due, left.get(w.id)!);
      left.set(w.id, left.get(w.id)! - part);
      own.get(w.id)!.push({ id: expense.id, amount: part });
      paid.push({ withdrawalId: w.id, amount: part });
      due -= part;
    }
    parts.set(expense.id, paid);
  }
  return {
    parts,
    uncovered,
    withdrawals: new Map(ordered.map((w) => [w.id, { spread: w.amount - left.get(w.id)!, left: left.get(w.id)!, expenses: own.get(w.id)! }])),
    left: [...left.values()].reduce((sum, amount) => sum + amount, 0),
  };
}

/** The cash in hand at the end of a day: withdrawn up to it, minus the covered expenses up to it. */
export function cashHeldOn(pocket: CashPocket, withdrawals: CashWithdrawal[], expenses: CashExpense[], date: IsoDate): Cents {
  const withdrawn = withdrawals.filter((w) => w.date <= date).reduce((sum, w) => sum + w.amount, 0);
  const spent = expenses.filter((e) => e.date <= date && !pocket.uncovered.has(e.id)).reduce((sum, e) => sum + e.amount, 0);
  return withdrawn - spent;
}

/**
 * How much a new expense on a date can take without leaving a later expense without cash: the
 * least cash held at the end of that day or of any later day with a covered expense.
 */
export function cashAvailableOn(pocket: CashPocket, withdrawals: CashWithdrawal[], expenses: CashExpense[], date: IsoDate): Cents {
  const later = expenses.filter((e) => e.date > date && !pocket.uncovered.has(e.id)).map((e) => e.date);
  return Math.min(...[date, ...later].map((day) => cashHeldOn(pocket, withdrawals, expenses, day)));
}

/**
 * Whether a cash expense, new or edited, can be saved next to the `others`: the cash must pay it
 * whole, and no other expense the cash pays in `before` (the pocket as it is now) may be left
 * without. An edit of an expense already uncovered may leave it so. When refused, `available` is
 * the cash held on its date when that can't pay it; otherwise `later` is set, and `available` is
 * what an expense on that date could take without leaving a later one without cash.
 */
export function checkCashExpense(
  withdrawals: CashWithdrawal[],
  others: CashExpense[],
  expense: CashExpense,
  before: CashPocket,
): { ok: true } | { ok: false; available: Cents; later: boolean } {
  const after = cashPocket(withdrawals, [...others, expense]);
  const mustCover = !before.uncovered.has(expense.id);
  const leavesOthers = others.some((other) => after.uncovered.has(other.id) && !before.uncovered.has(other.id));
  if (!leavesOthers && !(mustCover && after.uncovered.has(expense.id))) return { ok: true };
  const rest = cashPocket(withdrawals, others);
  const held = cashHeldOn(rest, withdrawals, others, expense.date);
  return held < expense.amount ? { ok: false, available: held, later: false } : { ok: false, available: cashAvailableOn(rest, withdrawals, others, expense.date), later: true };
}

/**
 * A covered cash expense as income and spending count it: an expense in its category, on its
 * date, counting as an imported one does. It belongs to no bank account, so it never shows in
 * balances or in Movimientos' totals.
 */
function asCountedExpense(expense: CashExpense): Transaction {
  return {
    id: expense.id,
    type: 'expense',
    amount: expense.amount,
    date: expense.date,
    accountId: '',
    toAccountId: null,
    categoryId: expense.categoryId,
    payeeId: null,
    note: expense.note,
    source: 'import',
    importBatchId: null,
    importHash: null,
    bookingDate: null,
    bankConcept: null,
    bankMovement: null,
    bankBalance: null,
    editedAt: expense.updatedAt,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
  };
}

/**
 * The transactions as income and spending count them with cash: each withdrawal of the pocket
 * counts 0, since taking cash out isn't spending, and each covered cash expense (in the date
 * range, when given) is added as an expense in its category and on its date. Uncovered ones
 * count nowhere. Balances and Movimientos never use this.
 */
export function withCash(transactions: Transaction[], pocket: CashPocket, expenses: CashExpense[], range?: { from: IsoDate; to: IsoDate }): Transaction[] {
  const counted = transactions.map((tx) => (pocket.withdrawals.has(tx.id) ? { ...tx, amount: 0 } : tx));
  const covered = expenses.filter((e) => !pocket.uncovered.has(e.id) && (!range || (e.date >= range.from && e.date <= range.to)));
  return [...counted, ...covered.sort(paymentOrder).map(asCountedExpense)];
}

/** Days after the last cash activity before Inicio reminds the user of their unspent cash. */
export const CASH_REMINDER_DAYS = 3;

/**
 * Whether to remind the user of their unspent cash on `today`: there's some left, and 3 days
 * passed since the latest of `activity` (the last withdrawal, the last cash expense noted down
 * and the last "Más tarde", as days; nulls are left out).
 */
export function cashReminderDue(left: Cents, activity: (IsoDate | null)[], today: IsoDate): boolean {
  const latest = activity.filter((day): day is IsoDate => day !== null).sort().at(-1);
  return left > 0 && latest !== undefined && daysBetween(latest, today) >= CASH_REMINDER_DAYS;
}
