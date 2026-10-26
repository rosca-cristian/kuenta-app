import { useNavigate, useSearchParams } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { ChevronRight } from 'lucide-react';
import { EmptyState, MonthSelector } from '../../ui/components';
import { IconBadge, colorFor } from '../../ui/icons';
import { usePrefersReducedMotion } from '../../ui/motion';
import { useRepoQuery } from '../../lib/repo';
import { Money } from '../../lib/money';
import { formatMonth, monthOf, today, type Month } from '../../domain/dates';
import type { SpendingEntryView } from '../../data/repository';
import { monthParam, transactionsLink } from '../transactions/filters';

/** "Sin categoría" is grey, as uncategorized rows are in Movimientos. */
const sliceColor = (entry: SpendingEntryView) => colorFor(entry.category?.color);

const entryName = (entry: SpendingEntryView) => entry.category?.name ?? 'Sin categoría';

/** A share of the month's total, rounded; a sliver shows as "<1 %" rather than "0 %". */
const formatShare = (percent: number) => (percent > 0 && percent < 0.5 ? '<1 %' : `${Math.round(percent)} %`);

/**
 * Análisis → Gastos: the month's spending by category as a donut with the total in its
 * centre, and the categories below it, highest first, as its legend. The month is in the
 * URL (`?mes=`), so coming back from Movimientos keeps it. Tapping a slice or a row opens
 * Movimientos with that month and category.
 */
export function Spending() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const currentMonth = monthOf(today());
  const asked = monthParam(params);
  // Current month and earlier: there's no spending in the future.
  const month: Month = asked !== null && asked <= currentMonth ? asked : currentMonth;
  const view = useRepoQuery((repo) => repo.spending(month), [month]);
  const reducedMotion = usePrefersReducedMotion();

  const open = (entry: SpendingEntryView) => navigate(transactionsLink(month, { categoryId: entry.category?.id ?? null }));

  return (
    <>
      <MonthSelector month={month} max={currentMonth} onChange={(next) => setParams({ mes: next }, { replace: true })} />
      {view &&
        (view.entries.length === 0 ? (
          <EmptyState title={`Sin gastos en ${formatMonth(month)}`}>
            Cuando importes movimientos de este mes verás aquí en qué categorías se fue el dinero.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-4 px-4 pb-4">
            <div className="relative h-60" data-testid="spending-donut">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={view.entries}
                    dataKey="amount"
                    nameKey={entryName}
                    innerRadius="68%"
                    outerRadius="100%"
                    startAngle={90}
                    endAngle={-270}
                    // A 2 px gap of the background between slices.
                    stroke="var(--color-bg)"
                    strokeWidth={view.entries.length > 1 ? 2 : 0}
                    isAnimationActive={!reducedMotion}
                    animationDuration={200}
                    onClick={(_, index) => open(view.entries[index])}
                    className="cursor-pointer"
                  >
                    {view.entries.map((entry) => (
                      <Cell key={entry.category?.id ?? 'none'} fill={sliceColor(entry)} name={entryName(entry)} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xs text-muted">Total</span>
                <span className="text-xl font-semibold tabular-nums" data-testid="spending-total"><Money cents={view.total} /></span>
              </div>
            </div>

            <ul aria-label="Gastos por categoría" className="overflow-hidden rounded-2xl border border-line bg-card">
              {view.entries.map((entry) => (
                <li key={entry.category?.id ?? 'none'} className="border-b border-line last:border-b-0">
                  <button className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left active:bg-card-2" onClick={() => open(entry)}>
                    <IconBadge icon={entry.category?.icon} color={entry.category?.color} size={36} />
                    <span className="min-w-0 flex-1 truncate">{entryName(entry)}</span>
                    <span className="text-xs text-muted tabular-nums" data-testid="spending-percent">{formatShare(entry.percent)}</span>
                    <span className="tabular-nums" data-testid="spending-amount"><Money cents={entry.amount} /></span>
                    <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </>
  );
}
