import { NavLink } from 'react-router-dom';
import { ChartPie, FileDown, House, List, Menu } from 'lucide-react';

const ITEMS = [
  { to: '/', label: 'Inicio', icon: House },
  { to: '/movimientos', label: 'Movimientos', icon: List },
  { to: '/importar', label: 'Importar', icon: FileDown },
  { to: '/analisis', label: 'Análisis', icon: ChartPie },
  { to: '/mas', label: 'Más', icon: Menu },
];

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-lg">
        {ITEMS.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${isActive ? 'text-accent' : 'text-muted'}`
              }
            >
              <Icon size={22} aria-hidden />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
