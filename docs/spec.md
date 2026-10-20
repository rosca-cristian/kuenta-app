# Spec: Kuenta v1

> Status: **approved** (October 2026).
> Supersedes `docs/especificacion.md` (removed; see git history). Built from `docs/catalogo-funciones.md` (feature research, kept in Spanish) and the design sessions of October 2026.
> Domain vocabulary is defined in `/CONTEXT.md`; key decisions are recorded in `docs/adr/`.

## 0. Decisions at a glance

| Topic | Decision |
|---|---|
| Platform | Installable PWA, static files only on GitHub Pages. No server, no accounts, no analytics. |
| Data | IndexedDB through Dexie.js, behind a repository interface. `navigator.storage.persist()` is requested. |
| Source of transactions | **Import only.** Every transaction comes from the BBVA statement export. Nothing is entered by hand (ADR-0001). |
| Import cadence | Weekly. |
| Import flow | BBVA app → Descargar → Hojas de cálculo → ⋮ → Compartir y exportar → Enviar una copia (.xlsx) → **Kuenta** (share target). "Elegir archivo" as an alternative. |
| Amounts | Integer cents (`number`) throughout the domain. Never floats for money. |
| Currency and locale | EUR only. **The UI is Spanish only**; dates and numbers in `es-ES`. Code, docs and glossary are in English. |
| Theme | Dark only. |
| Lock | No PIN. |
| Period | Calendar month (1st to last day). |
| Accounts | One **import account** (BBVA) plus any number of **non-imported accounts** (Revolut, savings, investments) fed by transfers. |
| UI | Tailwind CSS + own components on Radix UI (shadcn/ui approach) + Vaul (bottom sheets) + Lucide icons. |
| Charts | Recharts. |
| Excel reading | `read-excel-file` (xlsx only, small, MIT). The BBVA reader is isolated in `import/bbva/`, so the library can be swapped. |
| Tests | Vitest + fake-indexeddb (logic and data); Playwright at 390×844 (mobile UI). Excel fixtures are **synthetic**: real statements never enter the repo (it's public). |
| Branching and deploy | `main` is the default branch; every push to `main` deploys to GitHub Pages. Work happens on branches merged into `main`. |

---

## 1. Scope of v1

### Included

1. **Import of the BBVA statement** (§3.1): preview, duplicate detection on overlapping files, derived opening balance, balance check, gap detection, balance adjustment and undo.
2. **Transactions**: expense, income and transfer. Amount, date and account are locked; category, payee and note are editable; an expense or income can be turned into a transfer.
3. **Categories** with icon and colour (one level), with a Spanish starter set.
4. **Payees**, filled from the bank concept and renamed by rules.
5. **Rules** applied on import: set category, payee or note, or turn the transaction into a transfer to another account.
6. **Accounts**: the import account and non-imported accounts with an optional opening balance and "Actualizar saldo".
7. **Savings goals** linked to an account.
8. **Monthly budgets** per category.
9. **Home**: monthly summary, savings rate, end-of-month forecast and alerts.
10. **Charts**: spending by category (donut), income vs expenses (bars), net worth over time (line).
11. **Search and filters** on transactions.
12. **Backups**: full JSON export and restore, CSV export, share via the system menu, backup reminder.
13. **Privacy mode**: hide amounts.
14. **PWA**: installable, works offline, persistent storage, share target for `.xlsx` files.

### Removed from the earlier draft

Manual entry sheet and calculator keypad, templates/favourites, payee autocomplete, cleared status, matching imported rows against manual entries (including "Dudosos"), and recurring transactions. See ADR-0001.

---

## 2. Architecture

```
src/
  domain/          Pure logic, no React or Dexie (fully unit-tested)
    money.ts         cents: parse "12,50" → 1250, from bank number -207.33 → -20733, format 1250 → "12,50 €"
    dates.ts         'YYYY-MM-DD' dates with no time zone; months; add days/months
    balances.ts      balance per account and date, opening balance, net worth
    chain.ts         bank running-balance chain: ordering within a day, gap detection
    rules.ts         rules engine
    importPlan.ts    turns parsed rows into an import plan (new / already imported, warnings)
    budgets.ts       spending per category and month, effective limit, pace
    stats.ts         month summary, savings rate, forecast
    csv.ts           CSV export
    backup.ts        schema, validation and migrations of the JSON backup
  data/
    repository.ts    DataRepository interface (the only thing screens see)
    dexie/           Dexie (IndexedDB) implementation
    seed.ts          starter categories and rules
  import/bbva/     reads the BBVA .xlsx → normalized rows
  platform/        PlatformServices interface (share, pick file, persistence, download)
    web.ts           web implementation (Web Share API, <input type=file>, StorageManager)
  ui/              base components (button, sheet, list…)
  features/        screens by area (home, transactions, import, analysis, more…)
  sw.ts            own service worker (precache + receiving shared files)
```

- **Screens only talk to `DataRepository` and `PlatformServices`.** Packaging with Capacitor later only needs a `PlatformServices` implementation (and, if needed, a SQLite repository); screens don't change.
- Reactivity: the repository emits a `change` event after every write; a `useRepoQuery(fn)` hook re-runs its query on it. Dexie's `useLiveQuery` isn't used in screens, so they stay independent of Dexie.
- Writes that touch several tables (import, undo import, restore, delete category) run in **one transaction**: all or nothing.
- Routing with `HashRouter` (`#/movimientos`), so GitHub Pages never returns 404 on reload and it works the same inside Capacitor.
- Service worker via vite-plugin-pwa in `injectManifest` mode, because receiving shared files needs custom code. The share target's `action` URL must sit inside the app's scope (the Pages base path `/kuenta-app/`).
- System fonts (`system-ui`, Roboto on Android) with tabular figures: no Google Fonts or other external requests.
- IDs: `crypto.randomUUID()`.
- External data (JSON backup, Excel rows) is validated with **zod**.

---

## 3. Data model

Conventions:

- `Cents` is an integer: `12,34 €` is stored as `1234`.
- A transaction's `amount` is **always positive**; its type gives the sign.
- Dates are `'YYYY-MM-DD'` strings (local day, no time or zone); months are `'YYYY-MM'`.
- Technical timestamps (`createdAt`, `updatedAt`) are ISO 8601.
- `Id` is a UUID string.

```ts
type AccountType = 'bank' | 'savings' | 'investment' | 'other';

interface Account {
  id: Id;
  name: string;              // "BBVA", "Revolut", "Ahorro viaje"
  type: AccountType;
  openingBalance: Cents;     // import account: derived from imports (§3.2). Others: typed by the user, default 0. May be negative.
  color: string;             // palette token
  icon: string;              // Lucide icon name
  archived: boolean;
  order: number;
  createdAt: string; updatedAt: string;
}

type CategoryKind = 'expense' | 'income';

interface Category {
  id: Id;
  name: string;              // user data, in Spanish
  kind: CategoryKind;        // where it shows first in the picker; doesn't restrict use
  icon: string; color: string;
  order: number;
  archived: boolean;
}

interface Payee {
  id: Id;
  name: string;              // "Uber Eats"
  normalized: string;        // "uber eats" (lower case, no accents, single spaces), unique
}

type TxType = 'expense' | 'income' | 'transfer';
type TxSource = 'import' | 'adjustment';

interface Transaction {
  id: Id;
  type: TxType;
  amount: Cents;             // > 0
  date: string;              // value date ("Fecha valor")
  accountId: Id;             // the account the money leaves (transfer) or the only account
  toAccountId: Id | null;    // transfers only: the account the money enters
  categoryId: Id | null;     // null = "Sin categoría"; always null for transfers
  payeeId: Id | null;
  note: string;
  source: TxSource;
  // Bank data, only when source = 'import':
  importBatchId: Id | null;  // import that created it
  importHash: string | null; // fingerprint of the Excel row (§3.1)
  bookingDate: string | null;// "Fecha"
  bankConcept: string | null;// "Concepto", as in the file
  bankMovement: string | null;// "Movimiento", as in the file
  bankBalance: Cents | null; // "Disponible" right after this row
  editedAt: string | null;   // when the user last changed category, payee or note
  createdAt: string; updatedAt: string;
}

interface Rule {
  id: Id;
  name: string;
  order: number;             // the first enabled rule that matches wins
  enabled: boolean;
  match: {
    field: 'concept' | 'movement' | 'conceptOrMovement';
    op: 'contains' | 'startsWith' | 'equals';
    value: string;           // compared ignoring case and accents
    direction: 'any' | 'out' | 'in';   // charge, credit or both
  };
  actions: {
    categoryId?: Id;
    payeeName?: string;      // creates or reuses the payee
    note?: string;
    transferAccountId?: Id;  // turns it into a transfer with this account
  };
}

interface BudgetLimit {      // limit in force from a month onwards
  id: Id;
  categoryId: Id;
  fromMonth: string;         // 'YYYY-MM'
  amount: Cents;             // 0 = no budget from that month
}

interface Goal {
  id: Id;
  name: string;
  target: Cents;
  targetDate: string | null;
  accountId: Id;             // progress = balance of this account
  icon: string; color: string;
  archived: boolean;
}

interface ImportBatch {
  id: Id;
  importedAt: string;
  fileName: string;
  accountId: Id;
  dateFrom: string; dateTo: string;   // booking dates covered by the file
  rows: number; created: number; skipped: number;
  bankBalance: Cents;        // "Disponible" of the most recent row
  appBalance: Cents;         // the account's balance in Kuenta after importing
  undone: boolean;
}

interface Setting { key: string; value: unknown }
// keys: importAccountId, privacyMode, lastBackupAt, lastChangeAt,
//       onboardingDone, persistRequested, schemaVersion
```

### Dexie indexes (schema version 1)

```
accounts:      id, order
categories:    id, kind, order
payees:        id, &normalized
transactions:  id, date, [accountId+date], [toAccountId+date], categoryId, payeeId,
               &importHash, importBatchId, bookingDate
rules:         id, order
budgetLimits:  id, [categoryId+fromMonth]
goals:         id, accountId
importBatches: id, importedAt
settings:      key
```

### 3.1 The BBVA file

Format, confirmed with real exports (October 2026). The file is what Google Sheets produces with "Enviar una copia → Excel" from the BBVA download:

- One sheet, "Informe BBVA". A logo image, then title rows ("Movimientos", "Fecha de generación del informe: dd/mm/aaaa"), then the header row (row 5, starting at column B in the observed files).
- Columns: `Fecha valor, Fecha, Concepto, Movimiento, Importe, Divisa, Disponible, Divisa, Observaciones`. **"Divisa" appears twice**: the first belongs to Importe, the second to Disponible.
- `Importe` and `Disponible` are **numbers** (`-207.33`). Dates are **text** `dd/mm/aaaa`. Empty cells are empty strings.
- Rows are ordered **newest first**, in booking order. `Disponible` chains exactly: `Disponible(row) = Disponible(older row) + Importe(row)`.
- `Fecha valor` ≤ `Fecha`; card payments are booked up to 6 days later.
- `Movimiento` carries useful text: `Pago con tarjeta`, the payer of a salary (truncated to ~30 characters), and for Bizum the direction and note (`ENVIADO: …`, `Recibido: …`, `COMPRA: …`).
- Text may contain HTML entities (`&#39;`) that must be decoded.

**Fingerprint** of a row: value date, booking date, amount, concept, movement and Disponible. Disponible makes otherwise identical rows (two 23 € Bizum on the same day) distinct.

**Mapping a row to a transaction**: `date` = Fecha valor; `amount` = |Importe|; type = expense if Importe < 0, income if > 0 (rules may turn it into a transfer); payee = cleaned Concepto (§5.3), except for Bizum rows, where payee is empty and `Movimiento` becomes the note.

### 3.2 Calculation rules

- **Signed amount** of a transaction for an account: + for income and incoming transfers, − for expenses and outgoing transfers.
- **Balance of an account at a date** = `openingBalance` + signed amounts of its transactions with `date ≤` that date.
- **Opening balance of the import account** = Disponible − signed Importe of the **oldest imported row in booking order**. It's recomputed whenever an import adds an older row or an undo removes the oldest.
- **Bank order**: imported transactions are ordered by `bookingDate`; within a day, by reconstructing the chain of Disponible values.
- **Gap**: two consecutive imported transactions in bank order whose balances don't chain (`prev.bankBalance + signed(cur) ≠ cur.bankBalance`).
- **Balance check**: after an import, the import account's balance in Kuenta (all its transactions, adjustments included) is compared with the most recent Disponible on record.
- **Transfers** don't count as income or expense in the summary, charts, budgets or savings rate. They do count in balances, and net worth doesn't change.
- **Balance adjustments** count in balances but never as income or expense.
- **Spending of a category in a month** = expenses in that category − income in that category. A Bizum received from a friend for a shared dinner, categorized as Restaurantes, reduces Restaurantes spending.
- **Budget limit for month M** = the category's `BudgetLimit` with the most recent `fromMonth ≤ M`. Changing the limit in October doesn't rewrite September.
- **Net worth at month end** = sum of the balances of all accounts, archived and non-imported included.
- **Expected charge** (for the forecast): an expense of the previous month whose payee had an expense in each of the two previous months and has none yet in the current month. Its amount is last month's amount.

---

## 4. Screens

Fixed bottom navigation: **Inicio · Movimientos · Importar · Análisis · Más**. Every screen with a period uses the same `‹ octubre 2026 ›` selector. The eye icon for privacy mode sits in the header of Inicio and Movimientos.

### 4.1 First run
1. Welcome: what Kuenta is, that data only lives on this phone, and the weekly import routine.
2. Name the import account (proposed: "BBVA"). No balance is asked: it's derived from the first import.
3. Starter categories and rules are created, persistent storage is requested, and one sentence explains why backups matter.
4. Go straight to Importar with the step-by-step export instructions.

### 4.2 Inicio
- Month card: **total balance**, income, expenses, savings (amount and rate) and "A este ritmo gastarás X € este mes" (current month only).
- Alerts, only when they apply: "Han pasado N días desde la última importación" (from 8 days), "N movimientos sin categoría", "Hay un hueco entre el 07/10 y el 14/10", "N presupuestos superados", "Haz una copia de seguridad".
- Accounts with their balance (archived ones hidden; non-imported ones labelled "no importada").
- Budgets: the 3 with the highest percentage used, linking to the full screen.
- Goals: a progress bar for each.

### 4.3 Movimientos
- Text search (payee, note, bank concept and movement) and filters: month, account, category, type and "sin categoría".
- List grouped by day with a header such as "lunes, 20 oct · −45,30 €" (date and day's net).
- Row: circle with the category's icon and colour; payee or note; category · account in grey; amount on the right (income in green, expenses in normal text colour).
- Tapping a row opens the **edit sheet**: amount, date and account shown read-only; category, payee and note editable; "Convertir en transferencia" (pick the other account); the original bank concept and movement. For an incoming amount, the category picker shows first the **expense** categories used that same day.
- "Exportar CSV", respecting active filters.

### 4.4 Importar
- **Entry**: the export steps (BBVA → Descargar → Hojas de cálculo → ⋮ → Compartir y exportar → Enviar una copia → Kuenta), an "Elegir archivo" button and the import history (date, period, created, "Deshacer").
- **Preview** (opens by itself when a file is shared):
  - **Nuevos** (will be created): with the category set by a rule or "Sin categoría", editable in the row; a checkbox to exclude the row; the action "Crear regla con este concepto", which applies the new rule to the remaining new rows of this preview.
  - **Ya importados** (ignored): count only.
  - Warnings: gap before or after the file, rows older than the current opening balance (it will be recomputed), wrong currency.
- **Importar** button. Result screen: "Creados N · Saldo BBVA 1.234,56 € · Saldo en Kuenta 1.234,56 € ✓ Cuadra", or the difference with "Crear ajuste de saldo".

### 4.5 Análisis
Tabs:
- **Gastos**: the month's donut by category with the total in the centre, and below it the categories with amount and percentage (acting as the legend). Tapping a category opens Movimientos filtered.
- **Mensual**: income vs expenses bars for the last 6 or 12 months, with each month's net.
- **Patrimonio**: net worth at the end of each of the last 12 months.

### 4.6 Presupuestos
- Month selector. Total budgeted, spent and remaining.
- One card per budgeted category: spent / limit, a progress bar with a **"today" marker** (the month's pace) and a status of *En camino*, *Cerca* (≥ 85 %) or *Superado*.
- Filter Todos · Superados · En camino.
- Edit the limit "a partir de este mes" and add a budget to another category.

### 4.7 Objetivos
- List with name, current / target, percentage and, when there is a target date, how much to save per month to get there.
- Each goal shows its linked account's balance as progress.

### 4.8 Más
Cuentas · Categorías · Comercios · Reglas · Presupuestos · Objetivos · Copias de seguridad · Ajustes (import account, persistent storage status, space used, version, library licences).

### 4.9 Cuentas
- Create a non-imported account with name, type, icon, colour and an optional opening balance.
- "Actualizar saldo": type the real balance; Kuenta creates a balance adjustment for the difference.
- Archive. The import account can't be archived until another account is chosen as the import account.

### 4.10 Copias de seguridad
- "Exportar copia" (downloads the JSON) and "Compartir copia" (system menu: Drive, email, Telegram…).
- "Restaurar copia": pick the JSON, see a summary ("Copia del 12/10/2026: 3 cuentas, 845 movimientos…"), confirm with "Sustituir todos mis datos", optionally exporting current data first.
- "Exportar movimientos (CSV)" with a date range.
- Date of the last backup.

### Design (dark only)
- Near-black background, cards one shade lighter, subtle borders. One accent colour for primary actions. Green for income, amber for *Cerca*, red only for *Superado* and errors.
- Touch targets at least 44 px; honour `safe-area-inset-*`; tabular figures so amounts line up.
- Short animations (≤ 200 ms), disabled under `prefers-reduced-motion`.

---

## 5. Acceptance criteria

All checked at a 390×844 viewport. Items marked 🧪 have a unit test.

### 5.1 Amounts and formatting
- 🧪 Bank numbers become exact cents: `-207.33` → −20733, `0.08` → 8, `-50.0` → −5000, `1103.5` → 110350 (rounded, never truncated).
- 🧪 Text amounts are also accepted: "1.234,56" → 123456, "-0,5" → −50.
- 🧪 Formatting: 123456 → "1.234,56 €" (4-digit thousands are grouped too); −500 → "−5,00 €".
- 🧪 Dates show as "20/10/2026" in tables and CSV, and "lunes, 20 de octubre" in headers.
- In privacy mode every amount (chart axes and labels included) shows as "•••• €", and the mode persists across restarts.

### 5.2 Reading the BBVA file
- 🧪 Finds the header row by column names (ignoring case and accents), not by position, wherever it starts.
- 🧪 Handles the duplicated "Divisa" column by position relative to Importe and Disponible.
- 🧪 Accepts dates as text "dd/mm/aaaa" or as Excel serial numbers, and amounts as numbers or text with a decimal comma.
- 🧪 Decodes HTML entities in text (`pc&#39;s` → `pc's`).
- 🧪 If a required column (Fecha valor, Fecha, Concepto, Importe, Disponible) is missing, or a currency isn't EUR, shows a clear error and imports nothing.
- 🧪 If the file's own Disponible values don't chain, warns that the file looks incomplete.
- 🧪 The test fixture is a synthetic file with the exact real structure (logo, title rows, header at B5, duplicated Divisa, numeric amounts, text dates), with invented amounts and concepts.

### 5.3 Import
- 🧪 Each row creates one transaction dated with its **value date**; negative Importe → expense, positive → income.
- 🧪 Payee = Concepto cleaned (repeated spaces collapsed, first letter of each word upper-cased): `Uber   *eats` → "Uber *eats", `carrefour almer` → "Carrefour Almer". For `Bizum` rows the payee is empty and the note is the Movimiento text (`Recibido: desayuno`).
- 🧪 Re-importing the same file, or one with overlapping dates, creates 0 transactions: those rows show as "Ya importados".
- 🧪 Two otherwise identical rows with different Disponible are both imported.
- 🧪 The first import sets the opening balance so that the balance equals the most recent Disponible.
- 🧪 Importing an older file (August after September) recomputes the opening balance, and the balance still equals the most recent Disponible.
- 🧪 Importing week 1 and week 3 without week 2 reports a gap between them; importing week 2 later clears it.
- 🧪 The balance check reports "Cuadra" or the difference; "Crear ajuste de saldo" creates an uncategorized adjustment for the difference.
- 🧪 An import is saved in one transaction: if it fails, nothing is left half-done.
- 🧪 **Undo** deletes the transactions the import created and recomputes the opening balance. If any of them were edited since, it warns first ("N movimientos importados se han editado desde entonces; se borrarán igualmente").
- 🧪 Rules are applied to new rows (§5.7).
- **Share**: with the PWA installed on Android, "Enviar una copia" from Google Sheets shows Kuenta as a target and opens the preview, also offline.
- "Elegir archivo" leads to the same preview.

### 5.4 Transactions
- 🧪 Amount, date and account of an imported transaction can't be changed.
- 🧪 Turning an expense of 200 € into a transfer to Revolut removes it from expenses and adds 200 € to Revolut's balance; net worth doesn't change.
- 🧪 Turning an income into a transfer makes it an incoming transfer from the chosen account.
- A transfer can't have the same account on both sides.
- Single imported transactions can't be deleted; only a whole import can be undone. Balance adjustments can be deleted from their edit sheet (e.g. after importing the period that was missing).

### 5.5 Accounts and balances
- 🧪 A non-imported account with an opening balance of 500 € and an incoming transfer of 200 € has a balance of 700 €.
- 🧪 The balance at a date ignores later transactions.
- 🧪 "Actualizar saldo" to 650 € on that account creates a −50 € adjustment.
- An account with transactions can't be deleted, only archived. An archived account doesn't appear in pickers or on Inicio, but its transactions stay in the history and count in net worth. Goals linked to it keep showing its balance.
- The import account can't be archived without choosing another import account first.

### 5.6 Categories and payees
- On first run these categories exist:
  - Expense: Supermercado, Restaurantes, Transporte, Vivienda, Suministros, Salud, Ocio, Compras, Suscripciones, Viajes, Educación, Regalos, Comisiones e impuestos, Efectivo and Otros gastos.
  - Income: Nómina, Reembolsos, Intereses and Otros ingresos.
- They can be created, renamed, and have their icon, colour and order changed.
- 🧪 Deleting a used category asks for another category to move its transactions to, or "Sin categoría". Its budgets are deleted and the rules that used it are disabled, all in one transaction.
- 🧪 Two payees whose normalized names match are never created; the existing one is reused.

### 5.7 Rules
- 🧪 The first enabled rule that matches, by order, wins.
- 🧪 "Concepto contiene *mercadona*" matches "Mercadona - crta del inge", ignoring case and accents.
- 🧪 Direction *out* only matches negative Importe values.
- 🧪 A rule with `transferAccountId = Revolut` turns `Revolut**5625*` (−200 €) into a transfer BBVA → Revolut of 200 €.
- 🧪 Starter rule: Concepto contains "retirada" or "cajero" → category Efectivo (a cash withdrawal counts as spent the day it's withdrawn).
- From a preview row a rule can be created with the concept prefilled; once saved, it's applied to the remaining new rows of that preview.
- In v1 rules are only applied on import.

### 5.8 Search and filters
- 🧪 Search finds text in the payee, note, bank concept and movement, ignoring case and accents.
- Filters combine and show as removable chips.
- A month with 500 transactions scrolls smoothly on a mid-range phone.

### 5.9 Inicio and statistics
- 🧪 Savings rate = (income − expenses) / income for the month, without transfers; with no income it shows "—".
- 🧪 Forecast = (expenses so far excluding expected charges' payees) / days elapsed × days in month + expected charges not yet seen (§3.2). Only shown for the current month and from the 3rd.
- 🧪 The import reminder appears when 8 or more days have passed since the last import.
- The "sin categoría" alert opens Movimientos filtered.

### 5.10 Charts
- 🧪 The donut's slices match the list below it and the centre total, and refunds subtract (§3.2).
- 🧪 Monthly bars match each month's summary.
- 🧪 Each month's net worth equals the sum of all account balances on the last day of the month.
- Charts fit the screen width, read well on the dark background and show an empty state with text when there is no data.

### 5.11 Budgets
- 🧪 With a 300 € limit on "Restaurantes" from 2026-09 and a change to 250 € from 2026-11, October uses 300 € and November and December 250 €.
- 🧪 The "today" marker sits at (current day / days in month) of the width; status is *Cerca* from 85 % and *Superado* above 100 %.
- 🧪 Uncategorized expenses don't count in any budget.

### 5.12 Goals
- 🧪 A goal linked to the "Ahorro viaje" account shows that account's current balance as progress.
- 🧪 With a target date: "ahorra X €/mes" = (target − current) / months left (at least 1), rounded up to the cent.

### 5.13 Backups and CSV
- 🧪 **Round trip**: exporting, wiping everything and restoring leaves the data identical, table by table and field by field.
- 🧪 Restore validates the format (`app: "kuenta"`, `format`, each table's schema, references between tables). If anything fails, current data is untouched and the problem is explained.
- 🧪 A backup from an older format version is migrated on restore; one from a newer version is rejected with a message.
- 🧪 Restore replaces all data in one transaction.
- 🧪 **CSV**: UTF-8 with BOM, `;` separator, CRLF line endings and columns `Fecha;Tipo;Cuenta;Cuenta destino;Categoría;Comercio;Nota;Importe;Concepto banco`. Signed amount with a decimal comma (`-12,50`). Text with `;`, quotes or line breaks is escaped. Opens correctly in Spanish Excel with a double click.
- File names: `kuenta-copia-AAAA-MM-DD.json` and `kuenta-movimientos-AAAA-MM-DD.csv`.
- "Compartir copia" opens the system menu with the JSON file. If the browser can't share files, it downloads it.
- The reminder appears on Inicio when more than 7 days have passed since the last backup (or none was ever made) and data has changed since. It disappears after exporting or sharing.

### 5.14 PWA and storage
- The app installs from Chrome on Android with the "Kuenta" icon and name and opens full screen.
- After the first visit it works offline: open, import, browse, see charts and export.
- On first run `navigator.storage.persist()` is called and Ajustes shows whether it was granted.
- When a new version is available, "Hay una versión nueva · Actualizar" is shown, without reloading behind the user's back.
- 🧪 Dexie schema migrations keep the data (tested with data from the previous version).
- The app makes no requests to third-party domains (checked in the Playwright test).

---

## 6. Out of v1

| Feature | Reason or timing |
|---|---|
| Manual entry of transactions | Import only (ADR-0001). A simple form could come back later, but mixing manual and imported data brings back reconciliation. |
| Recurring transactions | They would duplicate imported rows. The forecast uses expected charges instead. |
| Templates, autocomplete, calculator, cleared status | Only made sense with manual entry. |
| Multi-currency | Complicates the whole model; EUR only. |
| Split transactions | Complicate balances, budgets, CSV and import. |
| Subcategories and tags | Not chosen. The model allows adding them later. |
| Other banks, Norma 43, PDF, the BBVA "Informe de gastos" export | The BBVA reader is isolated in `import/bbva` so other formats can be added. |
| Importing non-imported accounts (Revolut, investments) | Later; they would get their own reader. |
| Reading BBVA notifications | Requires a Capacitor APK. |
| Open banking, sync, automatic cloud backups | Require servers or external services. |
| PIN lock, encryption | Not chosen; can be added without touching the model. |
| Light theme, custom accent colour | Dark only. Colours live in CSS variables, so a light theme would be cheap. |
| Other UI languages | Spanish only. |
| Month starting on payday | Calendar month. |
| Applying rules to existing transactions | In v1 rules only run on import. |
| Debts and loans, calendar, heatmap, Sankey, custom reports, period comparison | Not chosen or of little value on a phone. |
| Shortcuts, widgets, notifications | Not chosen or impossible in a PWA. |
| Multi-user, AI, attachments, location | Out of scope. |
| APK packaging | Later phase; the architecture is ready (§2). |

---

## 7. Build plan

Each part ends with green tests, a commit, a summary and your go-ahead before the next one. Each part is a vertical slice you can use on the phone.

1. **Walking skeleton: import and see.**
   - Vite + React + TS + Tailwind, ESLint, Vitest.
   - `domain/`: money, dates, balances, bank chain and import plan, with tests.
   - BBVA reader with the synthetic fixture.
   - `DataRepository` (Dexie) for accounts, categories, payees, transactions, import batches and settings, tested on fake-indexeddb.
   - First run (import account, starter categories, persistent storage).
   - Importar: share target and "Elegir archivo", preview with Nuevos / Ya importados and warnings, derived opening balance, balance check with adjustment, gap detection and undo.
   - Movimientos: list grouped by day and the edit sheet (category, payee, note).
   - Inicio: balance, month summary, import reminder and "sin categoría" alert.
   - Dark theme, bottom navigation, base components, PWA (manifest, service worker, update prompt).
   - GitHub Actions → GitHub Pages on push to `main`, and a README (run, install on Android, weekly import).
2. **Rules and categories**: rules engine and screen, "Crear regla con este concepto" in the preview, starter rules, category and payee management.
3. **Transfers and non-imported accounts**: "Convertir en transferencia", rule transfers, Cuentas screen, "Actualizar saldo", archiving.
4. **Goals and budgets.**
5. **Charts and full Inicio**: category, monthly and net worth analysis, forecast with expected charges, budget and goal widgets.
6. **Search and filters**, CSV export.
7. **Backups**: export, share and restore JSON, reminder.
8. **Privacy mode and polish**: Playwright test at 390×844, third-party request check, final pass.
