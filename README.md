# Kuenta

Personal finance PWA fed by your bank's statement. Once a week you export your BBVA movements and share the file with Kuenta; it imports them, checks the balance against the bank's and lets you categorize and analyse where your money goes. Nothing is entered by hand, and all data lives only on your phone: no server, no accounts, no analytics.

- App (Spanish UI): https://rosca-cristian.github.io/kuenta-app/
- Spec: [`docs/spec.md`](docs/spec.md) · Glossary: [`CONTEXT.md`](CONTEXT.md) · Decisions: [`docs/adr/`](docs/adr/)

## Install on Android

1. Open https://rosca-cristian.github.io/kuenta-app/ in Chrome.
2. Menu ⋮ → **Instalar aplicación** (or "Añadir a pantalla de inicio").
3. Open Kuenta from its icon. Installing it is what makes it appear in Android's share sheet.

## Weekly import

1. In the BBVA app, open the account and download the movements.
2. When Android asks which app to open it with, choose **Hojas de cálculo** (Google Sheets).
3. In Sheets: ⋮ → **Compartir y exportar** → **Enviar una copia** → **Excel (.xlsx)**.
4. In the share sheet, choose **Kuenta**. The import preview opens.

Overlapping periods are fine: rows already imported are recognized and skipped. Kuenta derives the account's opening balance from the bank's running balance ("Disponible"), so the balance agrees with BBVA from the first import, and it warns when a period is missing between imports. The **Elegir archivo** button on Importar does the same from a file picker.

## Backups

Data is stored in the browser's IndexedDB on the phone, and Kuenta asks Chrome to keep it persistently. Uninstalling the app or clearing Chrome's site data deletes it, so keep a copy outside the phone: in **Más → Copias de seguridad**,

- **Exportar copia** downloads all your data as `kuenta-copia-AAAA-MM-DD.json`: accounts, categories, payees, transactions with your categorizations, notes and transfers, rules, budgets, goals and the import history.
- **Compartir copia** opens Android's share menu with that file, to save it to Drive or send it by email or Telegram. Where the browser can't share files, it downloads it instead.

The screen shows the date of your last backup. The file is plain JSON, readable without Kuenta, and never leaves the phone unless you share it. Restoring a backup arrives in a later update.

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
