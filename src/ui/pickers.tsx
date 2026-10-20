import { createElement } from 'react';
import { COLOR_NAMES, ICON_NAMES, colorFor, colorLabel, iconFor, iconLabel } from './icons';

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
