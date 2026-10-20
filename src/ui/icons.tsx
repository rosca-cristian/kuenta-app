import { createElement } from 'react';
import {
  Banknote, Briefcase, Car, CircleHelp, Ellipsis, Gamepad2, Gift, GraduationCap, HandCoins, HeartPulse, House, Landmark,
  Percent, PiggyBank, Plane, Plug, Receipt, Repeat, RotateCcw, ShoppingBag, ShoppingCart, Utensils,
  type LucideIcon,
} from 'lucide-react';

/** Icons available to categories and accounts, by stored name. */
const ICONS: Record<string, LucideIcon> = {
  'shopping-cart': ShoppingCart,
  utensils: Utensils,
  car: Car,
  home: House,
  plug: Plug,
  'heart-pulse': HeartPulse,
  gamepad: Gamepad2,
  'shopping-bag': ShoppingBag,
  repeat: Repeat,
  plane: Plane,
  'graduation-cap': GraduationCap,
  gift: Gift,
  receipt: Receipt,
  banknote: Banknote,
  ellipsis: Ellipsis,
  briefcase: Briefcase,
  'rotate-ccw': RotateCcw,
  percent: Percent,
  'piggy-bank': PiggyBank,
  'hand-coins': HandCoins,
  landmark: Landmark,
};

/** Palette tokens stored on categories and accounts. */
export const PALETTE: Record<string, string> = {
  green: '#3ecf8e', orange: '#f59e42', blue: '#4f8cff', brown: '#b0855b', yellow: '#e8c547', red: '#f0605d',
  purple: '#a77bf3', pink: '#ec6fae', indigo: '#7c83f5', cyan: '#3cc4dc', teal: '#2bb5a0', rose: '#f3778b',
  slate: '#8796ab', lime: '#9ccf3e', gray: '#7d848f',
};

/** Every icon name a category or account can have, in the order pickers show them. */
export const ICON_NAMES = Object.keys(ICONS);

/** Every palette token, in the order pickers show them. */
export const COLOR_NAMES = Object.keys(PALETTE);

/** Spanish names of the icons, read out by the icon picker. */
export const ICON_LABELS: Record<string, string> = {
  'shopping-cart': 'Carrito', utensils: 'Cubiertos', car: 'Coche', home: 'Casa', plug: 'Enchufe', 'heart-pulse': 'Corazón',
  gamepad: 'Mando', 'shopping-bag': 'Bolsa', repeat: 'Repetir', plane: 'Avión', 'graduation-cap': 'Birrete', gift: 'Regalo',
  receipt: 'Recibo', banknote: 'Billete', ellipsis: 'Puntos', briefcase: 'Maletín', 'rotate-ccw': 'Devolución',
  percent: 'Porcentaje', 'piggy-bank': 'Hucha', 'hand-coins': 'Monedas', landmark: 'Banco',
};

/** Spanish names of the palette colours, read out by the colour picker. */
export const COLOR_LABELS: Record<string, string> = {
  green: 'Verde', orange: 'Naranja', blue: 'Azul', brown: 'Marrón', yellow: 'Amarillo', red: 'Rojo', purple: 'Morado',
  pink: 'Rosa', indigo: 'Índigo', cyan: 'Cian', teal: 'Verde azulado', rose: 'Rosa palo', slate: 'Pizarra', lime: 'Lima',
  gray: 'Gris',
};

export function iconFor(name: string | undefined): LucideIcon {
  return (name && ICONS[name]) || CircleHelp;
}

export function colorFor(token: string | undefined): string {
  return (token && PALETTE[token]) || PALETTE.gray;
}

/** A coloured circle with an icon, as used for categories in lists. */
export function IconBadge({ icon, color, size = 40 }: { icon?: string; color?: string; size?: number }) {
  const hex = colorFor(color);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: `${hex}26`, color: hex }}
    >
      {createElement(iconFor(icon), { size: size * 0.5, 'aria-hidden': true })}
    </span>
  );
}
