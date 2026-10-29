import { z } from 'zod';
import type { IsoDate } from './dates';
import type { Account, BudgetLimit, Category, Goal, ImportBatch, Payee, Reimbursement, Rule, Setting, Transaction } from './model';

/**
 * The backup format version, independent of the Dexie schema version. A change to the format
 * raises it and adds a migration from the previous one, so older copies keep restoring.
 */
export const BACKUP_FORMAT = 2;

/**
 * The settings that describe the user's data, the only ones a backup carries. The others belong
 * to the device (`persistRequested`, `privacyMode`, `lastBackupAt`, `lastChangeAt`): restoring
 * them on another phone would bring stale state.
 */
export const BACKUP_SETTINGS: readonly string[] = ['importAccountId', 'starterDataVersion', 'starterRulesOffer', 'onboardingDone'];

/** Every table's rows, as stored in IndexedDB: same field names, cents as integers, dates as strings. */
export interface BackupData {
  accounts: Account[];
  categories: Category[];
  payees: Payee[];
  transactions: Transaction[];
  rules: Rule[];
  budgetLimits: BudgetLimit[];
  goals: Goal[];
  importBatches: ImportBatch[];
  /** Since format 2; a format 1 file restores with none. */
  reimbursements: Reimbursement[];
  /** Only the data settings (`BACKUP_SETTINGS`). */
  settings: Setting[];
}

/** The JSON backup of `docs/spec.md` §5.13: the full copy of the user's data that can be restored. */
export interface BackupFile {
  app: 'kuenta';
  format: typeof BACKUP_FORMAT;
  /** ISO 8601, from the app's clock. */
  exportedAt: string;
  /** The version of Kuenta that made it. */
  appVersion: string;
  data: BackupData;
}

/** `kuenta-copia-2026-10-20.json` for a backup made that day. */
export const backupFileName = (date: IsoDate) => `kuenta-copia-${date}.json`;

/** Days after the last backup before Inicio reminds the user to make another, if the data changed. */
export const BACKUP_REMINDER_DAYS = 7;

/**
 * Whether Inicio reminds the user to make a backup: the data changed since the last one, and
 * that one is more than `BACKUP_REMINDER_DAYS` old or was never made. Without a recorded
 * change (no data yet, or an install from before changes were recorded) there is nothing to remind of.
 */
export function isBackupDue(lastChangeAt: string | null, lastBackupAt: string | null, now: Date): boolean {
  if (lastChangeAt === null) return false;
  if (lastBackupAt === null) return true;
  const backupTime = Date.parse(lastBackupAt);
  return Date.parse(lastChangeAt) > backupTime && now.getTime() - backupTime > BACKUP_REMINDER_DAYS * 24 * 60 * 60 * 1000;
}

/** A backup of these rows, leaving out the device settings. */
export function createBackup(data: BackupData, exportedAt: string, appVersion: string): BackupFile {
  return {
    app: 'kuenta',
    format: BACKUP_FORMAT,
    exportedAt,
    appVersion,
    data: { ...data, settings: data.settings.filter((setting) => BACKUP_SETTINGS.includes(setting.key)) },
  };
}

/** The backup as plain JSON with 2-space indentation, readable without Kuenta. */
export const backupJson = (backup: BackupFile) => JSON.stringify(backup, null, 2);

/** A table of the backup, as `BackupData` names it. */
export type BackupTable = keyof BackupData;

/** What a backup holds, or what the app holds now: the counts the restore sheet shows. */
export interface BackupCounts {
  accounts: number;
  transactions: number;
  categories: number;
  payees: number;
  rules: number;
  /** Categories with a budget: a limit above 0 in some month. */
  budgets: number;
  goals: number;
  /** Incomes linked as reimbursements: with at least one link. */
  reimbursements: number;
}

/** A backup's date and counts, shown before restoring it. */
export interface BackupSummary extends BackupCounts {
  exportedAt: string;
}

/**
 * What's wrong with a damaged backup: a row that doesn't fit its table (`row` and `field`
 * when known; no table for the file's own fields), two rows sharing what must be unique, or
 * a row pointing at one that isn't in the copy.
 */
export type BackupDamage =
  | { kind: 'invalid'; table: BackupTable | null; row: number | null; field: string | null }
  | { kind: 'duplicate'; table: BackupTable; field: string }
  | { kind: 'reference'; table: BackupTable; field: string; target: BackupTable };

/**
 * Each field of the file and its tables in Spanish, for "La copia está dañada: …". Nested
 * fields go by their path (`match.value`); the same name means the same in every table.
 */
const FIELD_NAMES: Record<string, string> = {
  // The file's own fields.
  app: 'app',
  format: 'formato',
  exportedAt: 'fecha de la copia',
  appVersion: 'versión de la app',
  data: 'datos',
  // Shared by several tables.
  id: 'identificador',
  name: 'nombre',
  type: 'tipo',
  kind: 'tipo',
  color: 'color',
  icon: 'icono',
  archived: 'archivado',
  order: 'orden',
  createdAt: 'fecha de creación',
  updatedAt: 'fecha de modificación',
  amount: 'importe',
  date: 'fecha',
  accountId: 'cuenta',
  categoryId: 'categoría',
  // Accounts and payees.
  openingBalance: 'saldo inicial',
  normalized: 'nombre normalizado',
  // Categories.
  nextMonthFromDay: 'día desde el que cuenta para el mes siguiente',
  // Transactions.
  toAccountId: 'cuenta destino',
  payeeId: 'comercio',
  note: 'nota',
  source: 'origen',
  importBatchId: 'importación',
  importHash: 'huella de importación',
  bookingDate: 'fecha contable',
  bankConcept: 'concepto del banco',
  bankMovement: 'movimiento del banco',
  bankBalance: 'saldo del banco',
  editedAt: 'fecha de edición',
  // Rules.
  enabled: 'activa',
  match: 'condición',
  'match.field': 'campo de la condición',
  'match.op': 'comparación de la condición',
  'match.value': 'texto de la condición',
  'match.direction': 'sentido de la condición',
  actions: 'acciones',
  'actions.categoryId': 'categoría',
  'actions.transferAccountId': 'cuenta de la transferencia',
  'actions.payeeName': 'nombre del comercio',
  // Budget limits and goals.
  fromMonth: 'mes de inicio',
  target: 'importe objetivo',
  targetMonth: 'mes objetivo',
  // Imports.
  importedAt: 'fecha de importación',
  fileName: 'nombre del archivo',
  dateFrom: 'fecha inicial',
  dateTo: 'fecha final',
  rows: 'filas',
  created: 'creados',
  skipped: 'omitidos',
  appBalance: 'saldo en Kuenta',
  undone: 'deshecha',
  // Reimbursements.
  incomeId: 'ingreso',
  expenseId: 'gasto',
  'incomeId+expenseId': 'ingreso y gasto',
  // Settings.
  key: 'clave',
  value: 'valor',
  importAccountId: 'cuenta de importación',
  starterDataVersion: 'versión de los datos iniciales',
  starterRulesOffer: 'oferta de reglas iniciales',
  onboardingDone: 'primer uso completado',
};

/** A damaged field's name in Spanish (`amount` → "importe"); as it is in the file when Kuenta doesn't know it. */
export const backupFieldName = (field: string) => FIELD_NAMES[field] ?? field;

/**
 * Why a file can't be restored: it isn't a Kuenta backup (not JSON, or `app` isn't `kuenta`),
 * a newer Kuenta made it, or it's damaged.
 */
export type BackupError = { reason: 'not-kuenta' } | { reason: 'newer' } | { reason: 'damaged'; damage: BackupDamage };

export type BackupReadResult = { ok: true; backup: BackupFile; summary: BackupSummary } | { ok: false; error: BackupError };

/**
 * The format migrations, in order: the one at index `i` turns a format `i + 1` file into a
 * format `i + 2` one. A `data` that isn't an object is left for the schema to refuse.
 */
const MIGRATIONS: ((file: Record<string, unknown>) => Record<string, unknown>)[] = [
  // 1 → 2: reimbursements, which format 1 didn't have.
  (file) => ({
    ...file,
    format: 2,
    data: typeof file.data === 'object' && file.data !== null && !Array.isArray(file.data) ? { ...file.data, reimbursements: [] } : file.data,
  }),
];

const id = z.string().min(1);
const cents = z.number().int();
const isoDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const timestamp = z.iso.datetime({ offset: true });

const accountSchema = z.object({
  id,
  name: z.string(),
  type: z.enum(['bank', 'savings', 'investment', 'other']),
  openingBalance: cents,
  color: z.string(),
  icon: z.string(),
  archived: z.boolean(),
  order: z.number(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const categorySchema = z.object({
  id,
  name: z.string(),
  kind: z.enum(['expense', 'income']),
  icon: z.string(),
  color: z.string(),
  order: z.number(),
  archived: z.boolean(),
  // Since a late income could count in the next month; copies made before it have none, which is off.
  nextMonthFromDay: z.number().int().min(1).max(31).nullable().default(null),
});

const payeeSchema = z.object({ id, name: z.string(), normalized: z.string() });

const transactionSchema = z.object({
  id,
  type: z.enum(['expense', 'income', 'transfer']),
  amount: cents.nonnegative(),
  date: isoDate,
  accountId: id,
  toAccountId: id.nullable(),
  categoryId: id.nullable(),
  payeeId: id.nullable(),
  note: z.string(),
  source: z.enum(['import', 'adjustment']),
  importBatchId: id.nullable(),
  importHash: z.string().nullable(),
  bookingDate: isoDate.nullable(),
  bankConcept: z.string().nullable(),
  bankMovement: z.string().nullable(),
  bankBalance: cents.nullable(),
  editedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const ruleSchema = z.object({
  id,
  name: z.string(),
  order: z.number(),
  enabled: z.boolean(),
  match: z.object({
    field: z.enum(['concept', 'movement', 'conceptOrMovement']),
    op: z.enum(['contains', 'startsWith', 'equals']),
    value: z.string(),
    direction: z.enum(['any', 'out', 'in']),
  }),
  actions: z.object({ categoryId: id.optional(), transferAccountId: id.optional(), payeeName: z.string().optional() }),
});

const budgetLimitSchema = z.object({ id, categoryId: id, fromMonth: month, amount: cents.nonnegative() });

const goalSchema = z.object({
  id,
  name: z.string(),
  target: cents.positive(),
  targetMonth: month.nullable(),
  accountId: id,
  icon: z.string(),
  color: z.string(),
  archived: z.boolean(),
});

const importBatchSchema = z.object({
  id,
  importedAt: timestamp,
  fileName: z.string(),
  accountId: id,
  dateFrom: isoDate,
  dateTo: isoDate,
  rows: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  bankBalance: cents,
  appBalance: cents,
  undone: z.boolean(),
});

const reimbursementSchema = z.object({ id, incomeId: id, expenseId: id, amount: cents.positive() });

/** The data settings' values; any other setting (a device's, or one Kuenta doesn't know) is dropped on reading. */
const settingSchema = z.discriminatedUnion('key', [
  z.object({ key: z.literal('importAccountId'), value: id }),
  z.object({ key: z.literal('starterDataVersion'), value: z.number().int().nonnegative() }),
  z.object({ key: z.literal('starterRulesOffer'), value: z.enum(['pending', 'done']) }),
  z.object({ key: z.literal('onboardingDone'), value: z.boolean() }),
]);

const backupSchema = z.object({
  app: z.literal('kuenta'),
  format: z.literal(BACKUP_FORMAT),
  exportedAt: timestamp,
  appVersion: z.string(),
  data: z.object({
    accounts: z.array(accountSchema),
    categories: z.array(categorySchema),
    payees: z.array(payeeSchema),
    transactions: z.array(transactionSchema),
    rules: z.array(ruleSchema),
    budgetLimits: z.array(budgetLimitSchema),
    goals: z.array(goalSchema),
    importBatches: z.array(importBatchSchema),
    reimbursements: z.array(reimbursementSchema),
    settings: z
      .array(z.object({ key: z.string(), value: z.unknown() }))
      .transform((settings) => settings.filter((setting) => BACKUP_SETTINGS.includes(setting.key)))
      .pipe(z.array(settingSchema)),
  }),
});

const TABLES: readonly BackupTable[] = [
  'accounts',
  'categories',
  'payees',
  'transactions',
  'rules',
  'budgetLimits',
  'goals',
  'importBatches',
  'reimbursements',
  'settings',
];

/**
 * The first issue zod found in the file, as the table, row and field it's in. Rows count the
 * file's rows: the settings Kuenta doesn't restore are dropped before the data settings are
 * checked, so an issue there is counted back to the file's row.
 */
function invalidAt(path: readonly PropertyKey[], file: Record<string, unknown>): BackupDamage {
  if (path[0] !== 'data' || !TABLES.includes(path[1] as BackupTable)) {
    return { kind: 'invalid', table: null, row: null, field: path.length > 0 ? path.map(String).join('.') : null };
  }
  const table = path[1] as BackupTable;
  let row = typeof path[2] === 'number' ? path[2] : null;
  if (table === 'settings' && row !== null) row = fileSettingRow(file, row);
  const field = path.length > 3 ? path.slice(3).map(String).join('.') : null;
  return { kind: 'invalid', table, row, field };
}

/**
 * The file's row of the data setting at `index` among the data settings, when they were
 * checked: only once every row is a key and a value. Otherwise `index` is already the file's.
 */
function fileSettingRow(file: Record<string, unknown>, index: number): number {
  const rows = (file.data as { settings?: unknown } | undefined)?.settings;
  if (!Array.isArray(rows)) return index;
  const keyed = rows.every((row) => typeof row === 'object' && row !== null && typeof (row as { key?: unknown }).key === 'string');
  if (!keyed) return index;
  const dataRows = rows.flatMap((row: { key: string }, i) => (BACKUP_SETTINGS.includes(row.key) ? [i] : []));
  return dataRows[index] ?? index;
}

/**
 * The first broken promise between the backup's tables: unique ids per table, unique
 * `importHash` and payee `normalized`, unique setting keys, every reference to another
 * row present in the copy, and the reimbursements' invariants. Null when there's none.
 */
function damageIn(data: BackupData): BackupDamage | null {
  const ids = Object.fromEntries(
    TABLES.filter((table) => table !== 'settings').map((table) => [table, new Set((data[table] as { id: string }[]).map((row) => row.id))]),
  ) as Record<Exclude<BackupTable, 'settings'>, Set<string>>;

  for (const table of TABLES) {
    if (table === 'settings') continue;
    if (ids[table].size !== data[table].length) return { kind: 'duplicate', table, field: 'id' };
  }
  const unique = <T>(values: T[]) => new Set(values).size === values.length;
  if (!unique(data.settings.map((setting) => setting.key))) return { kind: 'duplicate', table: 'settings', field: 'key' };
  if (!unique(data.transactions.flatMap((tx) => (tx.importHash === null ? [] : [tx.importHash])))) {
    return { kind: 'duplicate', table: 'transactions', field: 'importHash' };
  }
  if (!unique(data.payees.map((payee) => payee.normalized))) return { kind: 'duplicate', table: 'payees', field: 'normalized' };

  const references: [BackupTable, string, BackupTable, (string | null | undefined)[]][] = [
    ['transactions', 'accountId', 'accounts', data.transactions.map((tx) => tx.accountId)],
    ['transactions', 'toAccountId', 'accounts', data.transactions.map((tx) => tx.toAccountId)],
    ['transactions', 'categoryId', 'categories', data.transactions.map((tx) => tx.categoryId)],
    ['transactions', 'payeeId', 'payees', data.transactions.map((tx) => tx.payeeId)],
    ['transactions', 'importBatchId', 'importBatches', data.transactions.map((tx) => tx.importBatchId)],
    ['rules', 'categoryId', 'categories', data.rules.map((rule) => rule.actions.categoryId)],
    ['rules', 'transferAccountId', 'accounts', data.rules.map((rule) => rule.actions.transferAccountId)],
    ['budgetLimits', 'categoryId', 'categories', data.budgetLimits.map((limit) => limit.categoryId)],
    ['goals', 'accountId', 'accounts', data.goals.map((goal) => goal.accountId)],
    ['importBatches', 'accountId', 'accounts', data.importBatches.map((batch) => batch.accountId)],
    ['reimbursements', 'incomeId', 'transactions', data.reimbursements.map((link) => link.incomeId)],
    ['reimbursements', 'expenseId', 'transactions', data.reimbursements.map((link) => link.expenseId)],
    ['settings', 'importAccountId', 'accounts', data.settings.filter((s) => s.key === 'importAccountId').map((s) => s.value as string)],
  ];
  for (const [table, field, target, values] of references) {
    const present = ids[target as Exclude<BackupTable, 'settings'>];
    if (values.some((value) => value != null && !present.has(value))) return { kind: 'reference', table, field, target };
  }
  if (!data.settings.some((setting) => setting.key === 'importAccountId')) {
    return { kind: 'invalid', table: 'settings', row: null, field: 'importAccountId' };
  }
  return reimbursementDamage(data);
}

/**
 * The first broken promise of the reimbursements, whose transactions are all in the copy: an
 * imported income linked to an imported expense, once per pair, and parts adding up to at most
 * the income's amount and, across incomes, the expense's. Null when there's none.
 */
function reimbursementDamage(data: BackupData): BackupDamage | null {
  const pairs = data.reimbursements.map((link) => `${link.incomeId} ${link.expenseId}`);
  if (new Set(pairs).size !== pairs.length) return { kind: 'duplicate', table: 'reimbursements', field: 'incomeId+expenseId' };

  const transactions = new Map(data.transactions.map((tx) => [tx.id, tx]));
  const spread = new Map<string, number>();
  const paidBack = new Map<string, number>();
  for (const [row, link] of data.reimbursements.entries()) {
    const income = transactions.get(link.incomeId)!;
    const expense = transactions.get(link.expenseId)!;
    if (income.source !== 'import' || income.type !== 'income') return { kind: 'invalid', table: 'reimbursements', row, field: 'incomeId' };
    if (expense.source !== 'import' || expense.type !== 'expense') return { kind: 'invalid', table: 'reimbursements', row, field: 'expenseId' };
    spread.set(income.id, (spread.get(income.id) ?? 0) + link.amount);
    paidBack.set(expense.id, (paidBack.get(expense.id) ?? 0) + link.amount);
    if (spread.get(income.id)! > income.amount || paidBack.get(expense.id)! > expense.amount) {
      return { kind: 'invalid', table: 'reimbursements', row, field: 'amount' };
    }
  }
  return null;
}

/** How many of each thing the rows hold. */
export function countsOf(data: BackupData): BackupCounts {
  return {
    accounts: data.accounts.length,
    transactions: data.transactions.length,
    categories: data.categories.length,
    payees: data.payees.length,
    rules: data.rules.length,
    budgets: new Set(data.budgetLimits.filter((limit) => limit.amount > 0).map((limit) => limit.categoryId)).size,
    goals: data.goals.length,
    reimbursements: new Set(data.reimbursements.map((link) => link.incomeId)).size,
  };
}

/**
 * Reads a backup file's text, checking everything before anything is written: that it's a
 * Kuenta backup, of a format this app knows (older ones are migrated first), each table's
 * rows, and the references and uniqueness between them.
 */
export function readBackup(text: string): BackupReadResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: { reason: 'not-kuenta' } };
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json) || (json as { app?: unknown }).app !== 'kuenta') {
    return { ok: false, error: { reason: 'not-kuenta' } };
  }
  let file = json as Record<string, unknown>;
  const format = file.format;
  if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) {
    return { ok: false, error: { reason: 'damaged', damage: { kind: 'invalid', table: null, row: null, field: 'format' } } };
  }
  if (format > BACKUP_FORMAT) return { ok: false, error: { reason: 'newer' } };
  for (const migrate of MIGRATIONS.slice(format - 1)) file = migrate(file);

  const parsed = backupSchema.safeParse(file);
  if (!parsed.success) return { ok: false, error: { reason: 'damaged', damage: invalidAt(parsed.error.issues[0].path, file) } };
  const backup = parsed.data as BackupFile;
  const damage = damageIn(backup.data);
  if (damage) return { ok: false, error: { reason: 'damaged', damage } };
  return { ok: true, backup, summary: { exportedAt: backup.exportedAt, ...countsOf(backup.data) } };
}
