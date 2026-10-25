import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, EmptyState } from '../../ui/components';
import { usePrefersReducedMotion } from '../../ui/motion';
import { useRepoQuery } from '../../lib/repo';
import { formatMonth } from '../../domain/dates';
import { formatCompactMoney, formatMoney, formatSignedMoney, type Cents } from '../../domain/money';
import { AXIS_TICK, shortMonth } from './chart';

/** Green above 0, red below, the normal text colour at 0. */
const signColour = (cents: Cents) => (cents > 0 ? 'text-income' : cents < 0 ? 'text-danger' : '');

/** The value axis always includes 0, below or above the line. */
const ZERO_BASED: [(min: number) => number, (max: number) => number] = [(min) => Math.min(0, min), (max) => Math.max(0, max)];

/**
 * Análisis → Patrimonio: today's net worth and its change since the end of last month,
 * over a line of the net worth at the end of each of the last 12 months. Every account
 * counts, archived and non-imported ones included.
 */
export function NetWorth() {
  const view = useRepoQuery((repo) => repo.netWorth(), []);
  const reducedMotion = usePrefersReducedMotion();

  if (!view) return null;
  if (view.latest === null) {
    return (
      <EmptyState title="Sin datos de patrimonio">
        Cuando importes movimientos verás aquí cómo evoluciona, mes a mes, el dinero de todas tus cuentas.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <Card>
        <p className="text-sm text-muted">Patrimonio hoy</p>
        <p className={`text-3xl font-semibold tabular-nums ${signColour(view.latest)}`} data-testid="net-worth-latest">
          {formatMoney(view.latest)}
        </p>
        {view.change !== null && (
          <p className="text-sm" data-testid="net-worth-change">
            <span className={`tabular-nums ${signColour(view.change)}`}>{formatSignedMoney(view.change)}</span>
            <span className="text-muted"> este mes</span>
          </p>
        )}
      </Card>

      <div className="h-60" data-testid="net-worth-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={view.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey="month" tickFormatter={shortMonth} tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            {/* From 0, so the compact labels stay distinct and a small change doesn't look like a fall. */}
            <YAxis tickFormatter={formatCompactMoney} tick={AXIS_TICK} axisLine={false} tickLine={false} width={72} domain={ZERO_BASED} />
            <Tooltip
              formatter={(value) => [formatMoney(Number(value)), 'Patrimonio']}
              labelFormatter={(month) => formatMonth(String(month))}
              contentStyle={{ background: 'var(--color-card-2)', border: '1px solid var(--color-line)', borderRadius: 12 }}
              labelStyle={{ color: 'var(--color-muted)' }}
              itemStyle={{ color: 'var(--color-text)' }}
              cursor={{ stroke: 'var(--color-line)' }}
            />
            <Line
              type="monotone"
              dataKey="netWorth"
              stroke="var(--color-accent)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--color-accent)', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              isAnimationActive={!reducedMotion}
              animationDuration={200}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
