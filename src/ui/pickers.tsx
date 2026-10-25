import { createElement, type ReactNode } from 'react';
import { COLOR_NAMES, ICON_NAMES, IconBadge, colorFor, colorLabel, iconFor, iconLabel } from './icons';
import type { Account, Category, Id } from '../domain/model';

/** Picks one icon of the icon set, drawn in the chosen colour. */
export function IconPicker({ value, color, onChange }: { value: string; color: string; onChange: (icon: string) => void }) {
  const hex = colorFor(color);
  return (
    <fieldset>
      <legend className="mb-2 text-sm text-muted">Icono</legend>
      <div className="grid grid-cols-7 gap-2">
        {ICON_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            aria-label={iconLabel(name)}
            aria-pressed={value === name}
            onClick={() => onChange(name)}
            className={`flex aspect-square items-center justify-center rounded-xl ${value === name ? 'ring-2 ring-accent' : 'bg-card-2'}`}
            style={value === name ? { background: `${hex}26`, color: hex } : undefined}
          >
            {createElement(iconFor(name), { size: 20, 'aria-hidden': true })}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Picks one colour of the palette. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm text-muted">Color</legend>
      <div className="grid grid-cols-8 gap-2">
        {COLOR_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            aria-label={colorLabel(name)}
            aria-pressed={value === name}
            onClick={() => onChange(name)}
            className={`aspect-square rounded-full ${value === name ? 'ring-2 ring-text ring-offset-2 ring-offset-card' : ''}`}
            style={{ background: colorFor(name) }}
          />
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Picks a category from a grid, in the order given. `withNone` adds "Sin categoría" at the
 * end; otherwise the caller decides what tapping the chosen category again means.
 */
export function CategoryGrid({
  categories,
  value,
  onPick,
  withNone = false,
}: {
  categories: Category[];
  /** The picked category; null is "Sin categoría", undefined picks nothing (e.g. a transfer). */
  value: Id | null | undefined;
  onPick: (id: Id | null) => void;
  withNone?: boolean;
}) {
  const options: (Category | null)[] = withNone ? [...categories, null] : categories;
  return (
    <fieldset>
      <legend className="mb-2 text-sm text-muted">Categoría</legend>
      <div className="grid grid-cols-4 gap-2">
        {options.map((category) => {
          const id = category?.id ?? null;
          return (
            <button
              key={id ?? 'none'}
              type="button"
              onClick={() => onPick(id)}
              aria-pressed={value === id}
              className={`flex flex-col items-center gap-1 rounded-xl p-2 text-[11px] leading-tight ${
                value === id ? 'bg-accent/20 ring-1 ring-accent' : 'bg-card-2'
              }`}
            >
              <IconBadge icon={category?.icon} color={category?.color} size={32} />
              <span className="line-clamp-2 text-center">{category?.name ?? 'Sin categoría'}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Picks an account from a list, in the order given; an archived one says so. `children` follow
 * the accounts, such as what to do when there are none, or a way back.
 */
export function AccountPicker({
  legend,
  accounts,
  value,
  onPick,
  children,
}: {
  legend: string;
  accounts: Account[];
  /** The picked account; undefined picks none (e.g. "Todas las cuentas"). */
  value?: Id;
  onPick: (id: Id) => void;
  children?: ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm text-muted">{legend}</legend>
      {accounts.map((account) => (
        <button
          key={account.id}
          type="button"
          onClick={() => onPick(account.id)}
          aria-pressed={value === account.id}
          className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-left ${value === account.id ? 'bg-accent/20 ring-1 ring-accent' : 'bg-card-2'}`}
        >
          <IconBadge icon={account.icon} color={account.color} size={32} />
          <span className="min-w-0 flex-1 truncate">{account.name}</span>
          {account.archived && <span className="shrink-0 text-xs text-muted">Archivada</span>}
        </button>
      ))}
      {children}
    </fieldset>
  );
}
