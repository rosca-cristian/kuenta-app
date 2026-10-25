import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button } from '../../ui/components';
import { Sheet } from '../../ui/Sheet';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { formatDate, today } from '../../domain/dates';
import type { BackupCounts, BackupDamage, BackupError, BackupReadResult, BackupTable } from '../../domain/backup';

/** Each table's rows in "La copia está dañada: …": one, with its article, and the table's name. */
const TABLE_NAMES: Record<BackupTable, [string, string]> = {
  accounts: ['una cuenta', 'cuentas'],
  categories: ['una categoría', 'categorías'],
  payees: ['un comercio', 'comercios'],
  transactions: ['un movimiento', 'movimientos'],
  rules: ['una regla', 'reglas'],
  budgetLimits: ['un presupuesto', 'presupuestos'],
  goals: ['un objetivo', 'objetivos'],
  importBatches: ['una importación', 'importaciones'],
  settings: ['un ajuste', 'ajustes'],
};

/** What's wrong with a damaged backup, in Spanish, naming the table and the field or reference. */
function damageText(damage: BackupDamage): string {
  switch (damage.kind) {
    case 'invalid': {
      if (damage.table === null) return `el campo «${damage.field ?? 'data'}» no es válido`;
      const where = [damage.row === null ? null : `fila ${damage.row + 1}`, damage.field === null ? null : `campo «${damage.field}»`];
      const detail = where.filter((part) => part !== null).join(', ');
      return `hay datos no válidos en ${TABLE_NAMES[damage.table][1]}${detail ? ` (${detail})` : ''}`;
    }
    case 'duplicate':
      return `hay filas repetidas en ${TABLE_NAMES[damage.table][1]} (campo «${damage.field}»)`;
    case 'reference':
      return `${TABLE_NAMES[damage.table][0]} apunta a ${TABLE_NAMES[damage.target][0]} que no está en la copia (campo «${damage.field}»)`;
  }
}

/** Why a file can't be restored, as the sheet shows it. */
export function backupErrorText(error: BackupError): string {
  switch (error.reason) {
    case 'not-kuenta':
      return 'El archivo no es una copia de Kuenta.';
    case 'newer':
      return 'Esta copia es de una versión más nueva de Kuenta. Actualiza la app para restaurarla.';
    case 'damaged':
      return `La copia está dañada: ${damageText(error.damage)}.`;
  }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "3 cuentas, 845 movimientos, …". */
function countsText(counts: BackupCounts): string {
  return [
    plural(counts.accounts, 'cuenta', 'cuentas'),
    plural(counts.transactions, 'movimiento', 'movimientos'),
    plural(counts.categories, 'categoría', 'categorías'),
    plural(counts.payees, 'comercio', 'comercios'),
    plural(counts.rules, 'regla', 'reglas'),
    plural(counts.budgets, 'presupuesto', 'presupuestos'),
    plural(counts.goals, 'objetivo', 'objetivos'),
  ].join(', ');
}

/** The route state Inicio reads to say "Copia restaurada". */
export const RESTORED_STATE = { restored: true };

/**
 * "Restaurar copia": a button that picks a JSON backup and opens a sheet with its summary
 * and "Sustituir todos mis datos", or the reason it can't be restored. Nothing changes until
 * the user confirms; then every table is replaced in one go and the app lands on Inicio with
 * "Copia restaurada". With `exportCurrent` (Copias de seguridad), the sheet also shows the
 * current data's counts and "Exportar mis datos actuales antes"; on the first run there's no
 * data to show or export.
 */
export function RestoreBackup({
  label = 'Restaurar copia',
  variant = 'secondary',
  disabled = false,
  exportCurrent,
  onRestored,
}: {
  label?: string;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  /** Downloads a backup of the current data, counting as one. */
  exportCurrent?: () => Promise<void>;
  /** Runs after the restore, before going to Inicio (e.g. requesting persistent storage). */
  onRestored?: () => Promise<void>;
}) {
  const repo = useRepo();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [read, setRead] = useState<BackupReadResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState(false);
  const [failed, setFailed] = useState(false);

  async function pick(file: File) {
    setExported(false);
    setFailed(false);
    setRead(repo.readBackup(await file.text()));
  }

  async function exportFirst() {
    setBusy(true);
    try {
      await exportCurrent!();
      setExported(true);
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!read?.ok) return;
    setBusy(true);
    try {
      await repo.restoreBackup(read.backup);
      await onRestored?.();
      setRead(null);
      navigate('/', { replace: true, state: RESTORED_STATE });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        data-testid="backup-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void pick(file);
        }}
      />
      <Button variant={variant} disabled={disabled || busy} onClick={() => input.current?.click()}>
        {label}
      </Button>
      <Sheet open={read !== null} onClose={() => !busy && setRead(null)} title="Restaurar copia">
        {read && !read.ok && (
          <div className="flex flex-col gap-4">
            <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm">
              {backupErrorText(read.error)}
            </p>
            <p className="text-sm text-muted">Tus datos no han cambiado.</p>
            <Button variant="secondary" onClick={() => input.current?.click()}>
              Elegir otro archivo
            </Button>
          </div>
        )}
        {read?.ok && (
          <RestoreSummary
            read={read}
            busy={busy}
            exported={exported}
            failed={failed}
            onExport={exportCurrent && (() => void exportFirst())}
            onRestore={() => void restore()}
          />
        )}
      </Sheet>
    </>
  );
}

function RestoreSummary({
  read,
  busy,
  exported,
  failed,
  onExport,
  onRestore,
}: {
  read: Extract<BackupReadResult, { ok: true }>;
  busy: boolean;
  exported: boolean;
  failed: boolean;
  onExport?: () => void;
  onRestore: () => void;
}) {
  const current = useRepoQuery((r) => (onExport ? r.dataCounts() : Promise.resolve(null)));
  const { summary } = read;

  return (
    <div className="flex flex-col gap-4">
      <p data-testid="backup-summary">
        Copia del {formatDate(today(new Date(summary.exportedAt)))}: {countsText(summary)}.
      </p>
      {onExport && (
        <>
          <p className="text-sm text-muted" data-testid="current-data">
            Se sustituirán todos tus datos actuales{current ? `: ${countsText(current)}` : ''}.
          </p>
          <Button variant="secondary" disabled={busy} onClick={onExport}>
            Exportar mis datos actuales antes
          </Button>
          {exported && (
            <p role="status" className="text-sm text-income">
              Datos actuales exportados.
            </p>
          )}
        </>
      )}
      {failed && (
        <p role="alert" className="text-sm text-danger">
          No se pudo restaurar la copia. Tus datos no han cambiado.
        </p>
      )}
      <Button variant="danger" disabled={busy} onClick={onRestore}>
        Sustituir todos mis datos
      </Button>
    </div>
  );
}

/** Inicio's "Copia restaurada", shown once after a restore until tapped. */
export function RestoredAlert() {
  const location = useLocation();
  const navigate = useNavigate();
  if ((location.state as typeof RESTORED_STATE | null)?.restored !== true) return null;
  return (
    <Alert onClick={() => navigate('.', { replace: true, state: null })}>
      <span role="status">Copia restaurada. Tus datos son los de la copia.</span>
    </Alert>
  );
}
