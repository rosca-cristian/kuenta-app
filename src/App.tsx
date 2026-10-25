import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { BottomNav } from './ui/BottomNav';
import { UpdatePrompt } from './ui/UpdatePrompt';
import { useRepoQuery } from './lib/repo';
import { Onboarding } from './features/onboarding/Onboarding';
import { Home } from './features/home/Home';
import { Transactions } from './features/transactions/Transactions';
import { Import } from './features/import/Import';
import { More } from './features/more/More';
import { PageHeader } from './ui/components';
import { Payees } from './features/payees/Payees';
import { Categories } from './features/categories/Categories';
import { Accounts } from './features/accounts/Accounts';
import { Rules } from './features/rules/Rules';
import { Budgets } from './features/budgets/Budgets';
import { Goals } from './features/goals/Goals';
import { Backups } from './features/more/Backups';
import { Licenses } from './features/more/Licenses';

// Análisis brings Recharts: its own chunk keeps it off the first load of Inicio and Importar.
// The service worker precaches every chunk, so it works offline too.
const Analysis = lazy(() => import('./features/analysis/Analysis').then((module) => ({ default: module.Analysis })));

export function App() {
  const settings = useRepoQuery((repo) => repo.getSettings());
  if (!settings) return null;

  return (
    <HashRouter>
      {settings.onboardingDone ? (
        <>
          <main className="mx-auto max-w-lg pb-[calc(env(safe-area-inset-bottom)+5rem)]">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/movimientos" element={<Transactions />} />
              <Route path="/importar" element={<Import />} />
              <Route
                path="/analisis/:tab?"
                element={
                  <Suspense fallback={<PageHeader title="Análisis" />}>
                    <Analysis />
                  </Suspense>
                }
              />
              <Route path="/mas" element={<More />} />
              <Route path="/mas/cuentas" element={<Accounts />} />
              <Route path="/mas/categorias" element={<Categories />} />
              <Route path="/mas/comercios" element={<Payees />} />
              <Route path="/mas/reglas" element={<Rules />} />
              <Route path="/mas/presupuestos" element={<Budgets />} />
              <Route path="/mas/objetivos" element={<Goals />} />
              <Route path="/mas/copias" element={<Backups />} />
              <Route path="/mas/licencias" element={<Licenses />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <BottomNav />
        </>
      ) : (
        <Routes>
          <Route path="*" element={<Onboarding />} />
        </Routes>
      )}
      <UpdatePrompt />
    </HashRouter>
  );
}
