import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { BottomNav } from './ui/BottomNav';
import { UpdatePrompt } from './ui/UpdatePrompt';
import { useRepoQuery } from './lib/repo';
import { Onboarding } from './features/onboarding/Onboarding';
import { Home } from './features/home/Home';
import { Transactions } from './features/transactions/Transactions';
import { Import } from './features/import/Import';
import { ComingSoon, More } from './features/more/More';
import { Payees } from './features/payees/Payees';
import { Categories } from './features/categories/Categories';
import { Rules } from './features/rules/Rules';

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
              <Route path="/analisis" element={<ComingSoon title="Análisis" />} />
              <Route path="/mas" element={<More />} />
              <Route path="/mas/categorias" element={<Categories />} />
              <Route path="/mas/comercios" element={<Payees />} />
              <Route path="/mas/reglas" element={<Rules />} />
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
