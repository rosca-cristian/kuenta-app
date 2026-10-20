# Kuenta

A local-only personal finance app: the user records their own money movements by hand and reconciles them against their bank's statement export.

## Language

**Payee**:
The other party of a transaction, whether a shop, a person or an employer. Shown in the Spanish UI as "Comercio".
_Avoid_: Beneficiary, beneficiario, merchant

**Import account**:
The single account that bank statement imports post into and reconcile against. It's a global setting, not a property of the account.
_Avoid_: BBVA account (as an account attribute)

**Balance**:
The amount in an account as of today: its initial balance plus every transaction dated today or earlier. Transactions dated in the future don't count yet.

**Scheduled transaction**:
A transaction dated in the future. It's already recorded but doesn't affect any balance until its date arrives.
_Avoid_: Pending transaction

**Balance adjustment**:
An uncategorized, cleared transaction created to make an account's balance agree with the bank's after an import.
