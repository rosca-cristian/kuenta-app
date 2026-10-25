import { useSearchParams } from 'react-router-dom';
import { Button } from '../../ui/components';
import { useRepoQuery, useServices } from '../../lib/repo';
import { monthOf, today } from '../../domain/dates';
import { csvFileName, transactionsCsv } from '../../domain/csv';
import { filterParams, periodParam, textParam } from './filters';

/**
 * Movimientos' "Exportar CSV": downloads what `listTransactions` returns for the URL's period,
 * search and filter, read the same way as the list. Disabled when there's nothing to export.
 */
export function ExportCsvButton() {
  const { repo, platform } = useServices();
  const [params] = useSearchParams();
  const period = periodParam(params, monthOf(today()));
  const text = textParam(params);
  const filter = filterParams(params);
  const transactions = useRepoQuery((repo) => repo.listTransactions(period, { ...filter, text }), [period, filter, text]);

  async function exportCsv() {
    if (!transactions) return;
    const { importAccountId } = await repo.getSettings();
    const csv = transactionsCsv(transactions, importAccountId);
    await platform.saveFile(new File([csv], csvFileName(today()), { type: 'text/csv;charset=utf-8' }));
  }

  return (
    <Button variant="ghost" disabled={!transactions?.length} onClick={() => void exportCsv()}>
      Exportar CSV
    </Button>
  );
}
