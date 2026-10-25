import { useState } from 'react';
import { Button, Card, PageHeader } from '../../ui/components';
import { useRepo, useRepoQuery, useServices } from '../../lib/repo';
import { formatDate, today } from '../../domain/dates';
import { backupFileName, backupJson } from '../../domain/backup';
import { CsvRangeExport } from './CsvRangeExport';
import { RestoreBackup } from './RestoreBackup';

/**
 * Más → Copias de seguridad: "Exportar copia" downloads the JSON backup of every table,
 * "Compartir copia" opens the system's share menu with it (or downloads it where files can't
 * be shared), "Restaurar copia" replaces all the data with a backup's, the date of the last
 * backup and the CSV export of a date range. Only a copy that reached the user counts as one:
 * a cancelled share doesn't.
 */
export function Backups() {
  const repo = useRepo();
  const { platform } = useServices();
  const status = useRepoQuery((r) => r.backupStatus());
  const [busy, setBusy] = useState(false);

  async function backupFile() {
    const backup = await repo.exportBackup();
    return new File([backupJson(backup)], backupFileName(today(new Date(backup.exportedAt))), { type: 'application/json' });
  }

  /** Makes the backup and hands it to `deliver`, which says whether it reached the user. */
  async function run(deliver: (file: File) => Promise<boolean>) {
    setBusy(true);
    try {
      if (await deliver(await backupFile())) await repo.markBackupMade();
    } finally {
      setBusy(false);
    }
  }

  const exportCopy = () =>
    run(async (file) => {
      await platform.saveFile(file);
      return true;
    });
  const shareCopy = () => run(async (file) => (await platform.shareFile(file)) !== 'cancelled');

  return (
    <>
      <PageHeader title="Copias de seguridad" back="/mas" />
      <div className="flex flex-col gap-4 px-4 pb-4">
        <Card>
          <p className="text-sm text-muted">
            Tus datos solo están en este teléfono. Guarda una copia fuera de él (en Drive, en tu correo…) para no perderlos si cambias
            de móvil o se borran los datos de Chrome.
          </p>
          <p className="mt-3" data-testid="last-backup">
            Última copia: {status === undefined ? '…' : status.lastBackupAt ? formatDate(today(new Date(status.lastBackupAt))) : 'Nunca'}
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button disabled={busy} onClick={() => void exportCopy()}>
              Exportar copia
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void shareCopy()}>
              Compartir copia
            </Button>
            <RestoreBackup disabled={busy} exportCurrent={exportCopy} />
          </div>
        </Card>
        <CsvRangeExport />
      </div>
    </>
  );
}
