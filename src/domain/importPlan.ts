import type { Cents } from './money';
import type { IsoDate } from './dates';
import { bankOrder, findGaps, type ChainLink, type Gap } from './chain';
import { cleanPayeeName, normalizeText } from './text';
import type { BankRow } from './bankRow';
import type { Id, Rule } from './model';
import { applyRules, type RuleSubject } from './rules';

export interface PlannedRow {
  /** Fingerprint of the bank row; identifies it across overlapping files. */
  hash: string;
  status: 'new' | 'already-imported';
  type: 'expense' | 'income';
  /** Positive. */
  amount: Cents;
  date: IsoDate;
  bookingDate: IsoDate;
  bankAmount: Cents;
  bankBalance: Cents;
  concept: string;
  movement: string;
  /** Set by the first rule that matches; null = "Sin categoría". */
  categoryId: Id | null;
  payeeName: string | null;
  note: string;
}

export type ImportWarning =
  | { kind: 'file-chain-broken'; gaps: Gap[] }
  | { kind: 'gaps'; gaps: Gap[] }
  | { kind: 'older-than-opening'; oldestExisting: IsoDate };

export interface ImportPlan {
  rows: PlannedRow[];
  dateFrom: IsoDate;
  dateTo: IsoDate;
  warnings: ImportWarning[];
}

/** Fingerprint of a bank row. "Disponible" makes otherwise identical rows distinct. */
export function rowHash(row: BankRow): string {
  return [row.valueDate, row.bookingDate, row.amount, row.concept, row.movement, row.balance].join('|');
}

const isBizum = (row: { concept: string }) => normalizeText(row.concept) === 'bizum';

/** What rules give a row: the first matching rule's category and payee, or a payee from its concept. */
function ruleOutcome(subject: RuleSubject, rules: Rule[]): Pick<PlannedRow, 'categoryId' | 'payeeName'> {
  const actions = applyRules(rules, subject);
  return {
    categoryId: actions?.categoryId ?? null,
    payeeName: actions?.payeeName ?? (isBizum(subject) || subject.concept === '' ? null : cleanPayeeName(subject.concept)),
  };
}

/**
 * Decides what an import would do: which rows are new, which were imported
 * before, what rules give each row, and what to warn about. `existing` are
 * the import account's imported transactions as chain links, with their
 * fingerprints.
 */
export function planImport(rows: BankRow[], existing: (ChainLink & { hash: string })[], rules: Rule[] = []): ImportPlan {
  const known = new Set(existing.map((link) => link.hash));
  const planned: PlannedRow[] = rows.map((row) => {
    const hash = rowHash(row);
    const status = known.has(hash) ? 'already-imported' : 'new';
    known.add(hash);
    return {
      hash,
      status,
      type: row.amount < 0 ? 'expense' : 'income',
      amount: Math.abs(row.amount),
      date: row.valueDate,
      bookingDate: row.bookingDate,
      bankAmount: row.amount,
      bankBalance: row.balance,
      concept: row.concept,
      movement: row.movement,
      ...ruleOutcome(row, rules),
      note: isBizum(row) ? row.movement : '',
    };
  });

  const bookingDates = rows.map((row) => row.bookingDate).sort();
  const warnings: ImportWarning[] = [];

  // The file's own rows should chain on their own.
  const fileGaps = findGaps(bankOrder(rows.map(toLink)));
  if (fileGaps.length > 0) warnings.push({ kind: 'file-chain-broken', gaps: fileGaps });

  const fresh = planned.filter((row) => row.status === 'new');
  if (existing.length > 0 && fresh.length > 0) {
    const oldestExisting = existing.map((link) => link.bookingDate).sort()[0];
    if (fresh.some((row) => row.bookingDate < oldestExisting)) {
      warnings.push({ kind: 'older-than-opening', oldestExisting });
    }
  }

  // Gaps that would remain once this file is imported, skipping the ones inside the file itself.
  const after = bankOrder([...existing, ...fresh.map((row) => ({ bookingDate: row.bookingDate, amount: row.bankAmount, balance: row.bankBalance }))]);
  const inFile = new Set(fileGaps.map((gap) => `${gap.after}|${gap.before}`));
  const gaps = findGaps(after).filter((gap) => !inFile.has(`${gap.after}|${gap.before}`));
  if (gaps.length > 0) warnings.push({ kind: 'gaps', gaps });

  return { rows: planned, dateFrom: bookingDates[0], dateTo: bookingDates[bookingDates.length - 1], warnings };
}

/** The plan with `rules` run again on its new rows; rows imported before and warnings stay as they are. */
export function reapplyRules(plan: ImportPlan, rules: Rule[]): ImportPlan {
  return {
    ...plan,
    rows: plan.rows.map((row) =>
      row.status === 'new' ? { ...row, ...ruleOutcome({ concept: row.concept, movement: row.movement, amount: row.bankAmount }, rules) } : row,
    ),
  };
}

function toLink(row: BankRow): ChainLink {
  return { bookingDate: row.bookingDate, amount: row.amount, balance: row.balance };
}
