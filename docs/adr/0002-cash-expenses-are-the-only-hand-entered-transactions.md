# Cash expenses are the only hand-entered transactions

ADR-0001 keeps every transaction a bank row, so cash is only visible as the withdrawal: 200 € from the cashpoint count as spent in "Efectivo" the day they're withdrawn, whatever they paid for. The user wants to see where cash goes. So a withdrawal (an imported expense in the "Efectivo" category, from a start date on) no longer counts as spending, and the user enters **cash expenses** by hand: an amount, an expense category, a date and an optional note. Only cash expenses count, each in its category and month. Cash not yet spent is money the user still holds, shown as "Efectivo".

This is a narrow exception to ADR-0001, not its replacement. Nothing else is entered by hand, and a cash expense never stands alone:

- **Cash expenses are backed by withdrawals.** Cash is one pocket. Each cash expense is paid from the oldest withdrawal with cash left that isn't later than the expense, and spills into the next one when it doesn't fit. This allocation is computed every time, never stored. An expense larger than the cash held on its date is refused. If a withdrawal goes away (an undone import, a new category), the expenses it no longer covers are kept but count nowhere ("Sin efectivo") until there's cash for them again.
- **The bank stays the truth for balances.** Bank balances, Movimientos' day totals and the bank's rows never change. Cash expenses only change what counts as spending, and the cash left only adds an "Efectivo" line to the user's money.
- **The past doesn't move.** Only withdrawals from "Contar el efectivo desde" on are cash in the pocket. Older ones keep counting as spent, as before.

## Consequences

- There is no reconciliation. A cash expense never matches or duplicates a bank row, because the bank has no row for it.
- Cash left unspent doesn't count as spending, so forgetting to enter cash expenses makes savings look higher. Inicio reminds the user every 3 days while cash is left.
- Cash expenses are the one thing a backup holds that the bank can't give back, so they are never deleted as a side effect: an undone import leaves them "Sin efectivo" instead.
- Any other hand entry (incomes in cash, split transactions, adjusting a bank amount) still needs its own decision. This ADR isn't a precedent for general manual entry.
