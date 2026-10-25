import { Button } from '../../ui/components';
import { useServices } from '../../lib/repo';
import { today } from '../../domain/dates';
import { csvFileName, transactionsCsv } from '../../domain/csv';
import type { TransactionView } from '../../data/repository';

/**
 * Movimientos' "Exportar CSV": downloads the transactions the list shows, in its order.
 * Disabled while they load and when there's nothing to export.
 */
export function ExportCsvButton({ transactions }: { transactions: TransactionView[] | undefined }) {
  const { platform } = useServices();

  async function exportCsv() {
    if (!transactions) return;
    await platform.saveFile(new File([transactionsCsv(transactions)], csvFileName(today()), { type: 'text/csv;charset=utf-8' }));
  }

  return (
    <Button variant="ghost" disabled={!transactions?.length} onClick={() => void exportCsv()}>
      Exportar CSV
    </Button>
  );
}
