import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button } from '../../ui/components';
import { Sheet } from '../../ui/Sheet';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { formatDate, today } from '../../domain/dates';
import { backupFieldName, type BackupCounts, type BackupDamage, type BackupError, type BackupReadResult, type BackupTable } from '../../domain/backup';

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
  reimbursements: ['un reembolso', 'reembolsos'],
  settings: ['un ajuste', 'ajustes'],
};

/** What's wrong with a damaged backup, in Spanish, naming the table and the field (by its Spanish name) or reference. */
function damageText(damage: BackupDamage): string {
  switch (damage.kind) {
    case 'invalid': {
      if (damage.table === null) return `el campo «${backupFieldName(damage.field ?? 'data')}» no es válido`;
      const where = [damage.row === null ? null : `fila ${damage.row + 1}`, damage.field === null ? null : `campo «${backupFieldName(damage.field)}»`];
      const detail = where.filter((part) => part !== null).join(', ');
      return `hay datos no válidos en ${TABLE_NAMES[damage.table][1]}${detail ? ` (${detail})` : ''}`;
    }
    case 'duplicate':
      return `hay filas repetidas en ${TABLE_NAMES[damage.table][1]} (campo «${backupFieldName(damage.field)}»)`;
    case 'reference':
      return `${TABLE_NAMES[damage.table][0]} apunta a ${TABLE_NAMES[damage.target][0]} que no está en la copia (campo «${backupFieldName(damage.field)}»)`;
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
    plural(counts.reimbursements, 'reembolso', 'reembolsos'),
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
  beforeRestore,
}: {
  label?: string;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  /** Downloads a backup of the current data, counting as one. */
  exportCurrent?: () => Promise<void>;
  /**
   * Runs once the user confirms, before the restore (e.g. requesting persistent storage): on
   * the first run, restoring finishes onboarding and takes the welcome screen away.
   */
  beforeRestore?: () => Promise<void>;
}) {
  const repo = useRepo();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  /** The picked file read as a backup, or 'unreadable' when its text couldn't be read at all. */
  const [read, setRead] = useState<BackupReadResult | 'unreadable' | null>(null);
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState<'done' | 'failed' | null>(null);
  const [failed, setFailed] = useState(false);

  async function pick(file: File) {
    setExported(null);
    setFailed(false);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setRead('unreadable');
      return;
    }
    setRead(repo.readBackup(text));
  }

  async function exportFirst() {
    setBusy(true);
    try {
      await exportCurrent!();
      setExported('done');
    } catch {
      setExported('failed');
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (read === null || read === 'unreadable' || !read.ok) return;
    setBusy(true);
    try {
      await beforeRestore?.();
      await repo.restoreBackup(read.backup);
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
        accept=".json,.txt,application/json,text/plain"
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
        {read !== null && (read === 'unreadable' || !read.ok) && (
          <div className="flex flex-col gap-4">
            <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm">
              {read === 'unreadable' ? 'No se ha podido leer el archivo.' : backupErrorText(read.error)}
            </p>
            <p className="text-sm text-muted">Tus datos no han cambiado.</p>
            <Button variant="secondary" onClick={() => input.current?.click()}>
              Elegir otro archivo
            </Button>
          </div>
        )}
        {read !== null && read !== 'unreadable' && read.ok && (
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
  exported: 'done' | 'failed' | null;
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
          {exported === 'done' && (
            <p role="status" className="text-sm text-income">
              Datos actuales exportados.
            </p>
          )}
          {exported === 'failed' && (
            <p role="alert" className="text-sm text-danger">
              No se han podido exportar tus datos actuales.
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

/**
 * Inicio's "Copia restaurada", shown once after a restore until tapped. The route state that
 * asks for it is cleared as soon as it shows: the history keeps it across reloads, which would
 * bring it back.
 */
export function RestoredAlert() {
  const location = useLocation();
  const navigate = useNavigate();
  const restored = (location.state as typeof RESTORED_STATE | null)?.restored === true;
  const [shown, setShown] = useState(restored);
  if (restored && !shown) setShown(true);
  useEffect(() => {
    if (restored) navigate('.', { replace: true, state: null });
  }, [restored, navigate]);
  if (!shown) return null;
  return (
    <Alert onClick={() => setShown(false)}>
      <span role="status">Copia restaurada. Tus datos son los de la copia.</span>
    </Alert>
  );
}
