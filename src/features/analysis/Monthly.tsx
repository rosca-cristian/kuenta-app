import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { Choice, EmptyState } from '../../ui/components';
import { usePrefersReducedMotion } from '../../ui/motion';
import { useRepoQuery } from '../../lib/repo';
import { useMoney } from '../../lib/money';
import { formatMonth } from '../../domain/dates';
import type { MonthlyRange } from '../../data/repository';
import { AXIS_TICK, shortMonth } from './chart';

const RANGES: Record<`${MonthlyRange}`, string> = { 6: '6 meses', 12: '12 meses' };

/** The range last chosen, kept while moving around the app. */
let lastRange: MonthlyRange = 6;

/** The current month's bars are lighter: a half month shouldn't look like a bad one. */
const opacity = (inProgress: boolean) => (inProgress ? 0.45 : 1);

/** Recharts wraps a label wider than the axis; a wider box keeps "1,2 mil €" on one line. */
const yTick = { ...AXIS_TICK, width: 120 };

/**
 * Análisis → Mensual: income (green) and expenses (neutral) bars for each of the last 6 or
 * 12 months, as Inicio's summary counts them, and below them each month's net, newest first.
 */
export function Monthly() {
  const [range, setRange] = useState<MonthlyRange>(lastRange);
  const view = useRepoQuery((repo) => repo.monthly(range), [range]);
  const reducedMotion = usePrefersReducedMotion();
  const { hidden, money, signedMoney, compactMoney } = useMoney();

  const choose = (next: MonthlyRange) => {
    lastRange = next;
    setRange(next);
  };

  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <Choice
        legend="Periodo"
        legendHidden
        name="monthly-range"
        value={String(range) as `${MonthlyRange}`}
        options={RANGES}
        onChange={(next) => choose(Number(next) as MonthlyRange)}
      />
      {view &&
        (view.entries.length === 0 ? (
          <EmptyState title="Sin movimientos todavía">Cuando importes movimientos verás aquí tus ingresos y gastos de cada mes.</EmptyState>
        ) : (
          <>
            <div className="h-56" data-testid="monthly-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={view.entries} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barGap={2} barCategoryGap="20%">
                  <CartesianGrid vertical={false} stroke="var(--color-line)" />
                  <XAxis dataKey="month" tickFormatter={shortMonth} tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tickFormatter={compactMoney} tick={yTick} axisLine={false} tickLine={false} width={64} />
                  {(['income', 'expenses'] as const).map((key) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      name={key === 'income' ? 'Ingresos' : 'Gastos'}
                      fill={key === 'income' ? 'var(--color-income)' : 'var(--color-muted)'}
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={!reducedMotion}
                      animationDuration={200}
                    >
                      {view.entries.map((entry) => (
                        <Cell key={entry.month} fillOpacity={opacity(entry.inProgress)} />
                      ))}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-4 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-income" aria-hidden /> Ingresos
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-muted" aria-hidden /> Gastos
              </span>
            </div>

            <ul aria-label="Balance por mes" className="overflow-hidden rounded-2xl border border-line bg-card">
              {[...view.entries].reverse().map((entry) => (
                <li key={entry.month} className="flex min-h-14 items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate first-letter:uppercase">
                      {formatMonth(entry.month)}
                      {entry.inProgress && <span className="ml-2 rounded-full bg-card-2 px-2 py-0.5 text-xs text-muted">en curso</span>}
                    </p>
                    <p className="truncate text-xs text-muted tabular-nums">
                      <span className="text-income">{hidden ? '' : '+'}{money(entry.income)}</span> · {hidden ? '' : '−'}{money(entry.expenses)}
                    </p>
                  </div>
                  <span className={`tabular-nums ${entry.net > 0 ? 'text-income' : ''}`} data-testid="monthly-net">
                    {signedMoney(entry.net)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ))}
    </div>
  );
}
