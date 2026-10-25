import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, DatabaseBackup, Gauge, Goal, ListOrdered, Shapes, Store, Wallet, type LucideIcon } from 'lucide-react';
import { Card, PageHeader } from '../../ui/components';
import { useRepoQuery, useServices } from '../../lib/repo';
import { formatStorageUsage } from './about';

/** Management screens reachable from Más, in the order of the spec (§4.8). */
const SECTIONS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/mas/cuentas', label: 'Cuentas', icon: Wallet },
  { to: '/mas/categorias', label: 'Categorías', icon: Shapes },
  { to: '/mas/comercios', label: 'Comercios', icon: Store },
  { to: '/mas/reglas', label: 'Reglas', icon: ListOrdered },
  { to: '/mas/presupuestos', label: 'Presupuestos', icon: Gauge },
  { to: '/mas/objetivos', label: 'Objetivos', icon: Goal },
  { to: '/mas/copias', label: 'Copias de seguridad', icon: DatabaseBackup },
];

export function More() {
  const { platform } = useServices();
  const accounts = useRepoQuery((repo) => repo.listAccounts());
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => void platform.isPersisted().then(setPersisted), [platform]);
  const [usage, setUsage] = useState<number | null | undefined>(undefined);
  useEffect(() => void platform.storageUsage().then(setUsage), [platform]);
  const importAccount = accounts?.find((account) => account.isImportAccount);

  return (
    <>
      <PageHeader title="Más" />
      <div className="flex flex-col gap-4 px-4">
        <nav aria-label="Gestión">
          <ul className="overflow-hidden rounded-2xl border border-line bg-card">
            {SECTIONS.map(({ to, label, icon: Icon }) => (
              <li key={to} className="border-b border-line last:border-b-0">
                <Link to={to} className="flex min-h-14 items-center gap-3 px-4 active:bg-card-2">
                  <Icon size={20} className="text-muted" aria-hidden />
                  <span className="flex-1">{label}</span>
                  <ChevronRight size={18} className="text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Card className="overflow-hidden">
          <h2 className="mb-2 font-medium">Ajustes</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Cuenta de importación</dt>
            <dd>{importAccount?.name ?? '—'}</dd>
            <dt className="text-muted">Almacenamiento persistente</dt>
            <dd>{persisted === null ? '…' : persisted ? 'Concedido' : 'No concedido'}</dd>
            <dt className="text-muted">Espacio usado</dt>
            <dd data-testid="storage-usage">{usage === undefined ? '…' : formatStorageUsage(usage)}</dd>
            <dt className="text-muted">Versión</dt>
            <dd>{__APP_VERSION__}</dd>
          </dl>
          <Link to="/mas/licencias" className="-mx-4 -mb-4 mt-2 flex min-h-12 items-center gap-3 border-t border-line px-4 active:bg-card-2">
            <span className="flex-1">Licencias</span>
            <ChevronRight size={18} className="text-muted" aria-hidden />
          </Link>
        </Card>
      </div>
    </>
  );
}
