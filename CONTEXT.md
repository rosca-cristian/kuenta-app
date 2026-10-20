# Kuenta

A local-only personal finance app: the user records their own money movements by hand and reconciles them against their bank's statement export.

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

**Payee**:
The other party of a transaction, whether a shop, a person or an employer. Shown in the Spanish UI as "Comercio".
_Avoid_: Beneficiary, beneficiario, merchant

**Import account**:
The single account that bank statement imports post into and reconcile against. It's a global setting, not a property of the account.
_Avoid_: BBVA account (as an account attribute)

**Balance**:
The amount in an account at a given date: its opening balance plus every transaction up to that date.

**Balance adjustment**:
An uncategorized, cleared transaction created to make an account's balance agree with the bank's after an import.
