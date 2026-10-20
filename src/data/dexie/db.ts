import Dexie, { type EntityTable } from 'dexie';
import type { Account, Category, ImportBatch, Payee, Rule, Transaction } from '../../domain/model';

export interface SettingRow {
  key: string;
  value: unknown;
}

export class KuentaDb extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  payees!: EntityTable<Payee, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  rules!: EntityTable<Rule, 'id'>;
  importBatches!: EntityTable<ImportBatch, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;

  constructor(name = 'kuenta') {
    super(name);
    this.version(1).stores({
      accounts: 'id, order',
      categories: 'id, kind, order',
      payees: 'id, &normalized',
      transactions:
        'id, date, [accountId+date], [toAccountId+date], categoryId, payeeId, &importHash, importBatchId, bookingDate',
      importBatches: 'id, importedAt',
      settings: 'key',
    });
    // Part 2: rules. Starter data for existing installs is added on startup, not here (see the repository).
    this.version(2).stores({ rules: 'id, order' });
  }
}
