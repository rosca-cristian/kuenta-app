import { useEffect } from 'react';
import { Navigate, NavLink, useLocation, useParams } from 'react-router-dom';
import { EmptyState, PageHeader } from '../../ui/components';
import { NetWorth } from './NetWorth';
import { Spending } from './Spending';
import { Subscriptions } from './Subscriptions';

const TABS = { gastos: 'Gastos', mensual: 'Mensual', patrimonio: 'Patrimonio', suscripciones: 'Suscripciones' } as const;

type Tab = keyof typeof TABS;

const isTab = (value: string | undefined): value is Tab => value !== undefined && value in TABS;

/** Where Análisis was last left (tab and its month), so the bottom bar's link comes back to it. */
let lastVisited = '/analisis/gastos';

/**
 * Análisis, lazy-loaded with Recharts in its own chunk. The tab is the last path segment
 * (`/analisis/gastos`), so back navigation and reloads keep it.
 */
export function Analysis() {
  const { tab } = useParams();
  const location = useLocation();
  const valid = isTab(tab);

  useEffect(() => {
    if (valid) lastVisited = location.pathname + location.search;
  }, [valid, location.pathname, location.search]);

  if (!valid) return <Navigate to={lastVisited} replace />;

  return (
    <>
      <PageHeader title="Análisis" />
      <div role="tablist" aria-label="Vistas de análisis" className="mx-4 mb-2 grid grid-cols-4 gap-1 rounded-xl bg-card p-1">
        {(Object.entries(TABS) as [Tab, string][]).map(([id, label]) => (
          <NavLink
            key={id}
            to={`/analisis/${id}`}
            replace
            role="tab"
            aria-selected={id === tab}
            className={`flex min-h-11 items-center justify-center rounded-lg px-1 text-center text-xs ${
              id === tab ? 'bg-accent/20 text-text ring-1 ring-accent' : 'text-muted'
            }`}
          >
            {label}
          </NavLink>
        ))}
      </div>
      <div role="tabpanel" aria-label={TABS[tab]}>
        {tab === 'gastos' ? (
          <Spending />
        ) : tab === 'patrimonio' ? (
          <NetWorth />
        ) : tab === 'suscripciones' ? (
          <Subscriptions />
        ) : (
          <EmptyState title="Próximamente">Esta vista llegará en una próxima versión.</EmptyState>
        )}
      </div>
    </>
  );
}
