# Transactions come only from the bank import

Kuenta never asks the user to enter transactions by hand: every transaction is a row of the weekly BBVA statement export, and its amount, date and account can't be edited. The user's goal is to analyse where money goes, not to track it in real time (the BBVA app already does that), and daily manual logging is what makes people abandon finance apps. Dropping manual entry also drops the hardest part of the earlier design: reconciling hand-entered transactions with imported rows (matching windows, ambiguous matches, cleared status), along with templates, autocomplete, the calculator keypad and recurring transactions, which would duplicate imported rows.

## Consequences

- Balances always agree with the bank, because the opening balance is derived from the bank's running balance ("Disponible") and every bank row is imported.
- Cash spending is only visible as the withdrawal (category "Efectivo"), and the data lags the bank by up to a week plus booking delays.
- Non-imported accounts (Revolut, savings, investments) only see what arrives from BBVA as transfers; their balance can be corrected with a balance adjustment.
- Adding manual entry later is possible, but it brings back reconciliation; see the matching rules in the superseded `docs/especificacion.md` (git history) for a worked design.
