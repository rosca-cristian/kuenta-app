import type { ReactNode } from 'react';
import { formatPercent } from '../../ui/components';
import { Money } from '../../lib/money';
import { formatMonth } from '../../domain/dates';
import type { SavingsProgress } from '../../domain/savings';

/**
 * The inside of the monthly savings target's card, in Objetivos and on Inicio: the title with
 * the percentage, "Llevas X de Y", a bar with the "today" marker (the month's pace, as in
 * Presupuestos) in the current month, and the status: what's left, *Conseguido*, or that the
 * month is below 0. The card around it says what tapping it does.
 */
export function SavingsMeter({ title, progress }: { title: ReactNode; progress: SavingsProgress }) {
  const { month, target, saved, percent, reached, today: marker } = progress;
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        {title}
        <span className="text-sm tabular-nums text-muted" data-testid="savings-percent">
          {formatPercent(percent)}
        </span>
      </div>
      <div className="mt-1 text-sm tabular-nums" data-testid="savings-progress">
        Llevas <Money cents={saved} /> <span className="text-muted">de <Money cents={target} /></span>
      </div>
      <div
        role="progressbar"
        aria-label={`Ahorrado en ${formatMonth(month)}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.floor(percent))}
        aria-valuetext={formatPercent(percent)}
        className="relative mt-2 h-2 rounded-full bg-card-2"
      >
        <div className={`h-full rounded-full ${reached ? 'bg-income' : 'bg-accent'}`} style={{ width: `${Math.min(100, percent)}%` }} />
        {marker !== null && (
          <div
            data-testid="today-marker"
            title="Hoy"
            className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-text"
            style={{ left: `${marker * 100}%` }}
          />
        )}
      </div>
      {saved < 0 ? (
        <div className="mt-2 text-sm text-danger" data-testid="savings-status">
          Vas por debajo de 0
        </div>
      ) : reached ? (
        <div className="mt-2 text-sm font-medium text-income" data-testid="savings-status">
          Conseguido
        </div>
      ) : (
        <div className="mt-2 text-sm tabular-nums text-muted" data-testid="savings-status">
          Te faltan <Money cents={target - saved} />
        </div>
      )}
    </>
  );
}
