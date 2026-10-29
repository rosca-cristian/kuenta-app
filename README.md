# Kuenta

Personal finance PWA fed by your bank's statement. Once a week you export your BBVA movements and share the file with Kuenta; it imports them, checks the balance against the bank's and lets you categorize and analyse where your money goes. Nothing is entered by hand, and all data lives only on your phone: no server, no accounts, no analytics.

- App (Spanish UI): https://rosca-cristian.github.io/kuenta-app/
- Spec: [`docs/spec.md`](docs/spec.md) · Glossary: [`CONTEXT.md`](CONTEXT.md) · Decisions: [`docs/adr/`](docs/adr/)

## Install on Android

1. Open https://rosca-cristian.github.io/kuenta-app/ in Chrome.
2. Menu ⋮ → **Instalar aplicación** (or "Añadir a pantalla de inicio").
3. Open Kuenta from its icon. Installing it is what makes it appear in Android's share sheet.
4. Moving from another phone? On the welcome screen, tap **Restaurar una copia** instead of **Empezar** and pick your `kuenta-copia-….json` (see [Backups](#backups)): Kuenta opens on Inicio with your data, no setup needed.

## Reimbursements

When friends pay you back a dinner by Bizum, open the received Bizum in **Movimientos** and tap **Es un reembolso**: tick the expenses it pays back (each part is filled for you, and can be changed). From then on only your part of the dinner counts as spending, in Inicio, Análisis and budgets, and the Bizum isn't income; balances don't change. The expense's sheet shows **Pagado · Te devolvieron · Tu parte**. Reimbursements are saved in backups (older copies, made before them, still restore), and the CSV export has a **Reembolsado** column next to **Importe**, the bank's amount.

## Salary paid at the end of the month

If your salary arrives on the last days of the month for the next one, open **Más → Categorías → Nómina** and turn on **Contar en el mes siguiente si llega tarde** with the day it usually arrives from (**A partir del día 25**): from then on a salary on or after that day counts as the next month's income in Inicio and Análisis, while Movimientos keeps it on the bank's date with "Cuenta en noviembre" under it, and balances don't change.

## Privacy mode

Tap the eye in the header of **Inicio** or **Movimientos** to blur every amount in the app (lists, totals, charts): each one becomes a grey smudge where the amount was, and the real amount isn't even on the page; percentages, counts and dates stay visible. While it's on, the amount fields of the edit sheets (a budget's limit, a goal's target, an account's opening balance, "Actualizar saldo") start empty; left empty, they never change the stored amount. Tap it again to show them. The choice belongs to this phone: it stays after closing the app, isn't saved in backups and isn't changed by restoring one. Exported backups and CSVs always have the real amounts.

## Weekly import

1. In the BBVA app, open the account and download the movements.
2. When Android asks which app to open it with, choose **Hojas de cálculo** (Google Sheets).
3. In Sheets: ⋮ → **Compartir y exportar** → **Enviar una copia** → **Excel (.xlsx)**.
4. In the share sheet, choose **Kuenta**. The import preview opens.

Overlapping periods are fine: rows already imported are recognized and skipped. Kuenta derives the account's opening balance from the bank's running balance ("Disponible"), so the balance agrees with BBVA from the first import, and it warns when a period is missing between imports. The **Elegir archivo** button on Importar does the same from a file picker.

## Backups

Data is stored in the browser's IndexedDB on the phone, and Kuenta asks Chrome to keep it persistently. Uninstalling the app or clearing Chrome's site data deletes it, so keep a copy outside the phone: in **Más → Copias de seguridad**,

- **Exportar copia** downloads all your data as `kuenta-copia-AAAA-MM-DD.json`: accounts, categories, payees, transactions with your categorizations, notes and transfers, rules, budgets, goals, reimbursements and the import history.
- **Compartir copia** opens Android's share menu with that file, to save it to Drive or send it by email or Telegram. Chrome doesn't share `.json` files, so the shared copy is named `kuenta-copia-AAAA-MM-DD.txt`: same content, and **Restaurar copia** accepts it. Where the browser can't share files, it downloads it instead.

- **Restaurar copia** brings a backup back, on this phone or a new one (on a new phone, the welcome screen's **Restaurar una copia** does the same, without step 3):
  1. Tap **Restaurar copia** and pick the `kuenta-copia-….json` file (from Downloads, Drive…).
  2. Check the summary: the copy's date and how many accounts, transactions, categories, payees, rules, budgets, goals and reimbursements it has, next to what you have now.
  3. Optionally tap **Exportar mis datos actuales antes** to keep a copy of your current data.
  4. Tap **Sustituir todos mis datos**. All your data is replaced by the copy's in one go, and Inicio says **Copia restaurada**.

  A file that can't be restored is refused and nothing changes: "El archivo no es una copia de Kuenta" (not a Kuenta backup), "Esta copia es de una versión más nueva de Kuenta. Actualiza la app para restaurarla." (update Kuenta first), or "La copia está dañada: …" naming what's wrong.

The screen shows the date of your last backup. The file is plain JSON, readable without Kuenta, and never leaves the phone unless you share it.

## Development

Requires Node 22.

```sh
npm install
npm run dev        # http://localhost:5173/kuenta-app/
npm test           # unit and integration tests (Vitest + fake-indexeddb)
npm run e2e        # end-to-end at 390×844 (Playwright; builds and serves the app)
npm run lint
npm run typecheck
npm run build      # static files in dist/
```

To run the end-to-end tests with an already installed Chromium, set `PW_CHROMIUM=/path/to/chrome`.

Tests use synthetic BBVA files built by `test/support/bbvaXlsx.ts`, which reproduces the real export's structure. **Never commit real statements**: the repository is public, and `.gitignore` excludes `*.xlsx`.

Every push runs lint, type checks and both test suites in GitHub Actions; a push to `main` also deploys to GitHub Pages.
