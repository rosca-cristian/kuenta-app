import { createElement } from 'react';
import {
  Banknote, Briefcase, Car, CircleHelp, Ellipsis, Gamepad2, Gift, GraduationCap, HandCoins, HeartPulse, House, Landmark,
  Percent, PiggyBank, Plane, Plug, Receipt, Repeat, RotateCcw, ShoppingBag, ShoppingCart, Utensils,
  type LucideIcon,
} from 'lucide-react';

/** Icons available to categories and accounts, by stored name, with their Spanish name for screen readers. */
const ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  'shopping-cart': { icon: ShoppingCart, label: 'Carrito' },
  utensils: { icon: Utensils, label: 'Cubiertos' },
  car: { icon: Car, label: 'Coche' },
  home: { icon: House, label: 'Casa' },
  plug: { icon: Plug, label: 'Enchufe' },
  'heart-pulse': { icon: HeartPulse, label: 'Corazón' },
  gamepad: { icon: Gamepad2, label: 'Mando' },
  'shopping-bag': { icon: ShoppingBag, label: 'Bolsa' },
  repeat: { icon: Repeat, label: 'Repetir' },
  plane: { icon: Plane, label: 'Avión' },
  'graduation-cap': { icon: GraduationCap, label: 'Birrete' },
  gift: { icon: Gift, label: 'Regalo' },
  receipt: { icon: Receipt, label: 'Recibo' },
  banknote: { icon: Banknote, label: 'Billete' },
  ellipsis: { icon: Ellipsis, label: 'Puntos' },
  briefcase: { icon: Briefcase, label: 'Maletín' },
  'rotate-ccw': { icon: RotateCcw, label: 'Devolución' },
  percent: { icon: Percent, label: 'Porcentaje' },
  'piggy-bank': { icon: PiggyBank, label: 'Hucha' },
  'hand-coins': { icon: HandCoins, label: 'Monedas' },
  landmark: { icon: Landmark, label: 'Banco' },
};

/** Palette tokens stored on categories and accounts, with their Spanish name for screen readers. */
const PALETTE: Record<string, { hex: string; label: string }> = {
  green: { hex: '#3ecf8e', label: 'Verde' },
  orange: { hex: '#f59e42', label: 'Naranja' },
  blue: { hex: '#4f8cff', label: 'Azul' },
  brown: { hex: '#b0855b', label: 'Marrón' },
  yellow: { hex: '#e8c547', label: 'Amarillo' },
  red: { hex: '#f0605d', label: 'Rojo' },
  purple: { hex: '#a77bf3', label: 'Morado' },
  pink: { hex: '#ec6fae', label: 'Rosa' },
  indigo: { hex: '#7c83f5', label: 'Índigo' },
  cyan: { hex: '#3cc4dc', label: 'Cian' },
  teal: { hex: '#2bb5a0', label: 'Verde azulado' },
  rose: { hex: '#f3778b', label: 'Rosa palo' },
  slate: { hex: '#8796ab', label: 'Pizarra' },
  lime: { hex: '#9ccf3e', label: 'Lima' },
  gray: { hex: '#7d848f', label: 'Gris' },
};

/** Every icon name a category or account can have, in the order pickers show them. */
export const ICON_NAMES = Object.keys(ICONS);

/** Every palette token, in the order pickers show them. */
export const COLOR_NAMES = Object.keys(PALETTE);

export function iconLabel(name: string): string {
  return ICONS[name]?.label ?? name;
}

export function colorLabel(token: string): string {
  return PALETTE[token]?.label ?? token;
}

export function iconFor(name: string | undefined): LucideIcon {
  return (name && ICONS[name]?.icon) || CircleHelp;
}

export function colorFor(token: string | undefined): string {
  return (token && PALETTE[token]?.hex) || PALETTE.gray.hex;
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
