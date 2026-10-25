import { useState } from 'react';
import { Button, Card } from '../../ui/components';
import { useRepoQuery, useServices } from '../../lib/repo';
import { today, type IsoDate } from '../../domain/dates';
import { csvFileName, transactionsCsv } from '../../domain/csv';

const inputClass = 'min-h-11 w-full rounded-xl border border-line bg-card-2 px-3 text-base text-text outline-none focus:border-accent';

/**
 * Copias de seguridad's "Exportar movimientos (CSV)": the transactions dated from "Desde" to
 * "Hasta", both included, in Movimientos' CSV format. The range starts as the whole history,
 * the first transaction's date to today. A CSV can't be restored, so it isn't a backup.
 */
export function CsvRangeExport() {
  const { platform } = useServices();
  // Newest first: the last one is the first transaction.
  const firstDate = useRepoQuery(async (r) => (await r.listTransactions(null)).at(-1)?.date ?? null);
  const [picked, setPicked] = useState<{ from?: IsoDate; to?: IsoDate }>({});
  const from = picked.from ?? firstDate ?? today();
  const to = picked.to ?? today();
  // Until the first date is known, "Desde" isn't its default yet: nothing to count or complain about.
  const loading = picked.from === undefined && firstDate === undefined;
  const valid = from !== '' && to !== '' && from <= to;
  const transactions = useRepoQuery((r) => (valid ? r.listTransactions(null, { from, to }) : Promise.resolve([])), [from, to, valid]);

  const problem = loading
    ? null
    : !valid
      ? from === '' || to === ''
        ? 'Elige las dos fechas.'
        : '«Desde» es posterior a «Hasta».'
      : transactions?.length === 0
        ? 'No hay movimientos entre esas fechas.'
        : null;

  async function exportCsv() {
    if (!transactions?.length) return;
    await platform.saveFile(new File([transactionsCsv(transactions)], csvFileName(today()), { type: 'text/csv;charset=utf-8' }));
  }

  return (
    <Card>
      <h2 className="font-medium">Movimientos en CSV</h2>
      <p className="mt-1 text-sm text-muted">Para tus propias cuentas en una hoja de cálculo. No es una copia: no se puede restaurar.</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="flex min-w-0 flex-col gap-1 text-sm text-muted">
          Desde
          <input type="date" value={from} onChange={(event) => setPicked((p) => ({ ...p, from: event.target.value }))} className={inputClass} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm text-muted">
          Hasta
          <input type="date" value={to} onChange={(event) => setPicked((p) => ({ ...p, to: event.target.value }))} className={inputClass} />
        </label>
      </div>
      <p className="mt-3 text-sm" data-testid="csv-range-count" role={problem ? 'alert' : undefined}>
        {problem ?? (loading || transactions === undefined ? '…' : `${transactions.length} ${transactions.length === 1 ? 'movimiento' : 'movimientos'}`)}
      </p>
      <Button variant="secondary" className="mt-3 w-full" disabled={loading || !transactions?.length} onClick={() => void exportCsv()}>
        Exportar movimientos (CSV)
      </Button>
    </Card>
  );
}
