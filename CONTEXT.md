# Kuenta

A local-only personal finance app: the user imports their bank's statement export every week and categorizes and analyzes the transactions. Nothing is entered by hand.

## Language

**Transaction**:
One money movement in an account, taken from a row of the bank statement. Its amount, date and account come from the bank and can't be edited. Its category, payee and note belong to the user.
_Avoid_: Movement, entry, record

**Value date**:
The date the money actually moved (when you paid), as opposed to the date the bank booked it. A transaction's date is its value date.
_Avoid_: Booking date (for the transaction's date)

**Opening balance**:
The account's balance before its first transaction. For the import account it's derived from the imports (the balance before the oldest imported row), never typed; for a non-imported account it's typed by the user (default 0).
_Avoid_: Initial balance

**Transfer**:
A transaction that moves money between two of the user's own accounts. It is neither income nor expense, and it never has a category.
_Avoid_: Traspaso (in docs), internal movement

**Payee**:
The other party of a transaction, whether a shop, a person or an employer. Shown in the Spanish UI as "Comercio".
_Avoid_: Beneficiary, beneficiario, merchant

**Import account**:
The single account that bank statement imports post into. It's a global setting, not a property of the account.
_Avoid_: BBVA account (as an account attribute)

**Non-imported account**:
An account no statement is imported into (Revolut, savings, investments). Its balance is its opening balance plus the transfers that reach or leave it and its balance adjustments.
_Avoid_: Manual account, external account

**Balance**:
The amount in an account at a given date: its opening balance plus every transaction up to that date.

**Balance adjustment**:
An uncategorized transaction created to make an account's balance agree with reality: the bank's after an import that doesn't add up (e.g. rows missing from the file), or the balance the user types with "Actualizar saldo" on a non-imported account.

**Gap**:
A stretch of time with transactions missing between two imports, detected because the bank's running balance doesn't chain from the last imported row to the first new one.
_Avoid_: Hole, missing period

**Expected charge**:
An expense from a payee that was charged in each of the last two months and hasn't been charged yet this month. Used to forecast the month's spending.
_Avoid_: Recurring transaction

**Subscription**:
A service the user pays for periodically, identified by its payee: any payee with expenses in the "Suscripciones" category. Its frequency and cost come from its imported charges; nothing about it is entered by hand.
_Avoid_: Recurring, membership

**Category**:
The user's label for what an income or expense was for (Supermercado, Nómina…). One level, no subcategories. Transfers and balance adjustments never have one.
_Avoid_: Tag, label

**Rule**:
A user-editable instruction that recognizes transactions by the bank's text (concept or movement) and sets their category or payee. Rules run on import and, when the user asks, on existing transactions the user never edited; they never override what the user set by hand.
_Avoid_: Filter, automation

**Starter rule**:
A rule Kuenta ships with for common Spanish merchants (supermarkets, fuel, delivery, cash withdrawals). Once created it's an ordinary rule the user can edit or delete.
