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
The account's balance before its oldest imported transaction, derived from the first import, not typed by the user.
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

**Balance**:
The amount in an account at a given date: its opening balance plus every transaction up to that date.

**Balance adjustment**:
An uncategorized transaction created to make an account's balance agree with the bank's after an import that doesn't add up (e.g. rows missing from the file).

**Gap**:
A stretch of time with transactions missing between two imports, detected because the bank's running balance doesn't chain from the last imported row to the first new one.
_Avoid_: Hole, missing period

**Expected charge**:
An expense from a payee that was charged in each of the last two months and hasn't been charged yet this month. Used to forecast the month's spending.
_Avoid_: Recurring transaction, subscription

**Category**:
The user's label for what an income or expense was for (Supermercado, Nómina…). One level, no subcategories. Transfers and balance adjustments never have one.
_Avoid_: Tag, label

**Rule**:
A user-editable instruction that recognizes transactions by the bank's text (concept or movement) and sets their category or payee. Rules run on import and, when the user asks, on existing transactions the user never edited; they never override what the user set by hand.
_Avoid_: Filter, automation

**Starter rule**:
A rule Kuenta ships with for common Spanish merchants (supermarkets, fuel, delivery, cash withdrawals). Once created it's an ordinary rule the user can edit or delete.
