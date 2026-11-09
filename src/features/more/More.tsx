import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, DatabaseBackup, Gauge, Goal, ListOrdered, Shapes, Store, Wallet, type LucideIcon } from 'lucide-react';
import { Alert, Button, Card, PageHeader } from '../../ui/components';
import { Sheet } from '../../ui/Sheet';
import { useRepo, useRepoQuery, useServices } from '../../lib/repo';
import { formatDate, isIsoDate, today, type IsoDate } from '../../domain/dates';
import { uncoveredWarning } from '../accounts/cashText';
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
  const settings = useRepoQuery((repo) => repo.getSettings());
  const [movingCashStart, setMovingCashStart] = useState(false);

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
            <dt className="text-muted">Contar el efectivo desde</dt>
            <dd>
              <button type="button" className="-my-3 min-h-11 text-accent active:opacity-70" onClick={() => setMovingCashStart(true)} data-testid="cash-from-date">
                {settings?.cashFromDate ? formatDate(settings.cashFromDate) : '—'}
              </button>
            </dd>
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
      <Sheet open={movingCashStart} onClose={() => setMovingCashStart(false)} title="Contar el efectivo desde">
        {settings?.cashFromDate && <CashStartForm key={settings.cashFromDate} current={settings.cashFromDate} onDone={() => setMovingCashStart(false)} />}
      </Sheet>
    </>
  );
}

/**
 * Moves the day withdrawals start going to the cash pocket: earlier ones count as spent, as they
 * did before cash expenses. Warns of the cash expenses it would leave without cash.
 */
function CashStartForm({ current, onDone }: { current: IsoDate; onDone: () => void }) {
  const repo = useRepo();
  const [date, setDate] = useState(current);
  const valid = isIsoDate(date) && date <= today();
  const uncovered = useRepoQuery((r) => (valid ? r.cashExpensesUncoveredBy({ cashFromDate: date }) : Promise.resolve(0)), [date, valid]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    await repo.setCashFromDate(date);
    onDone();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Las retiradas de efectivo desde ese día dejan de contar como gasto: cuenta lo que apuntes que pagaste con ese efectivo. Las anteriores siguen contando
        como gasto.
      </p>
      <label className="flex flex-col gap-1 text-sm text-muted">
        Fecha
        <input
          type="date"
          value={date}
          max={today()}
          onChange={(event) => setDate(event.target.value)}
          className="min-h-11 rounded-xl border border-line bg-card-2 px-3 text-base text-text outline-none focus:border-accent"
        />
      </label>
      {!!uncovered && <Alert tone="warn">{uncoveredWarning(uncovered)}</Alert>}
      <Button type="submit" disabled={!valid}>
        Guardar
      </Button>
    </form>
  );
}
