import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { addMonths, formatMonth, type Month } from '../domain/dates';
import type { Cents } from '../domain/money';
import { Money } from '../lib/money';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const styles = {
    primary: 'bg-accent text-white',
    secondary: 'bg-card-2 text-text border border-line',
    danger: 'bg-danger/15 text-danger',
    ghost: 'text-accent',
  }[variant];
  return (
    <button
      className={`min-h-11 rounded-xl px-4 font-medium transition-opacity active:opacity-70 disabled:opacity-40 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-card p-4 ${className}`}>{children}</section>;
}

/** A screen's title. `back` adds a link to the parent screen, for screens nested under a tab. */
export function PageHeader({ title, action, back }: { title: string; action?: ReactNode; back?: string }) {
  return (
    <header className="flex min-h-14 items-center justify-between gap-2 px-4 pt-[env(safe-area-inset-top)]">
      <div className="flex min-w-0 items-center">
        {back && (
          <Link to={back} aria-label="Volver" className="-ml-3 flex size-11 shrink-0 items-center justify-center text-muted">
            <ChevronLeft />
          </Link>
        )}
        <h1 className="truncate text-xl font-semibold">{title}</h1>
      </div>
      {action}
    </header>
  );
}

/**
 * A percentage as shown on a progress bar: rounded down up to 100, so it never claims 85 % before
 * *Cerca* or 100 % before the target, and rounded up above it, so *Superado* never reads 100 %.
 */
export const formatPercent = (percent: number) => `${percent > 100 ? Math.ceil(percent) : Math.floor(percent)} %`;

/** `‹ octubre 2026 ›`; with `max`, it can't go past that month. */
export function MonthSelector({ month, onChange, max }: { month: Month; onChange: (month: Month) => void; max?: Month }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <button
        type="button"
        aria-label="Mes anterior"
        className="flex size-11 items-center justify-center text-muted"
        onClick={() => onChange(addMonths(month, -1))}
      >
        <ChevronLeft />
      </button>
      <span className="min-w-36 text-center font-medium capitalize">{formatMonth(month)}</span>
      <button
        type="button"
        aria-label="Mes siguiente"
        disabled={max !== undefined && month >= max}
        className="flex size-11 items-center justify-center text-muted disabled:opacity-30"
        onClick={() => onChange(addMonths(month, 1))}
      >
        <ChevronRight />
      </button>
    </div>
  );
}

/** An amount; income in green, expenses in the normal text colour. Privacy mode blurs it and drops the sign (see Money). */
export function Amount({ cents, kind, className = '' }: { cents: Cents; kind?: 'income' | 'expense' | 'neutral'; className?: string }) {
  const colour = kind === 'income' ? 'text-income' : '';
  const sign = kind === 'income' ? '+' : kind === 'expense' ? '−' : '';
  return <Money cents={kind ? Math.abs(cents) : cents} sign={sign} className={`tabular-nums ${colour} ${className}`} />;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-8 py-16 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', children, onClick }: { tone?: 'info' | 'warn'; children: ReactNode; onClick?: () => void }) {
  const style = tone === 'warn' ? 'border-warn/40 bg-warn/10' : 'border-line bg-card-2';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`w-full rounded-xl border px-4 py-3 text-left text-sm ${style}`}>
      {children}
    </Tag>
  );
}

/** A row of mutually exclusive options, as segmented buttons. */
export function Choice<T extends string>({
  legend,
  legendHidden = false,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  /** Keeps the legend for screen readers only, where the options speak for themselves. */
  legendHidden?: boolean;
  name: string;
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  const entries = Object.entries(options) as [T, string][];
  return (
    <fieldset>
      <legend className={legendHidden ? 'sr-only' : 'mb-1 text-sm text-muted'}>{legend}</legend>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}>
        {entries.map(([option, label]) => (
          <label
            key={option}
            className={`relative flex min-h-11 items-center justify-center rounded-xl px-1 text-center text-xs leading-tight ${
              value === option ? 'bg-accent/20 ring-1 ring-accent' : 'bg-card-2'
            }`}
          >
            <input
              type="radio"
              name={name}
              checked={value === option}
              onChange={() => onChange(option)}
              className="absolute inset-0 cursor-pointer appearance-none rounded-xl focus-visible:ring-2 focus-visible:ring-accent"
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** An active filter, with a button that removes it. */
export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-accent/40 bg-accent/15 pl-3 text-sm" data-testid="filter-chip">
      <span className="truncate">{label}</span>
      <button type="button" aria-label={`Quitar filtro ${label}`} className="flex size-11 shrink-0 items-center justify-center text-muted" onClick={onRemove}>
        <X size={16} aria-hidden />
      </button>
    </span>
  );
}
