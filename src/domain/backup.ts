import type { IsoDate } from './dates';
import type { Account, BudgetLimit, Category, Goal, ImportBatch, Payee, Rule, Setting, Transaction } from './model';

/**
 * The backup format version, independent of the Dexie schema version. A change to the format
 * raises it and adds a migration from the previous one, so older copies keep restoring.
 */
export const BACKUP_FORMAT = 1;

/**
 * The settings that describe the user's data, the only ones a backup carries. The others belong
 * to the device (`persistRequested`, `lastBackupAt`, `lastChangeAt`): restoring them on another
 * phone would bring stale state.
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
