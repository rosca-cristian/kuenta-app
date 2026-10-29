import Dexie, { type EntityTable } from 'dexie';
import type { Account, BudgetLimit, Category, Goal, ImportBatch, Payee, Reimbursement, Rule, SavingsTarget, Setting, Transaction } from '../../domain/model';

export class KuentaDb extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  payees!: EntityTable<Payee, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  rules!: EntityTable<Rule, 'id'>;
  budgetLimits!: EntityTable<BudgetLimit, 'id'>;
  goals!: EntityTable<Goal, 'id'>;
  savingsTargets!: EntityTable<SavingsTarget, 'id'>;
  reimbursements!: EntityTable<Reimbursement, 'id'>;
  importBatches!: EntityTable<ImportBatch, 'id'>;
  settings!: EntityTable<Setting, 'key'>;

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
    // Part 4: budgets and goals. Existing installs start with both empty.
    this.version(3).stores({ budgetLimits: 'id, [categoryId+fromMonth]', goals: 'id, accountId' });
    // Reimbursements: existing installs start with none, and no transaction changes.
    this.version(4).stores({ reimbursements: 'id, incomeId, expenseId' });
    // A late income counting in the next month: off for every existing category. No index, so no table changes.
    this.version(5).stores({}).upgrade(async (tx) => {
      await tx.table<Category>('categories').toCollection().modify((category) => {
        category.nextMonthFromDay ??= null;
      });
    });
    // The monthly savings target: existing installs start with none.
    this.version(6).stores({ savingsTargets: 'id, fromMonth' });
  }
}
