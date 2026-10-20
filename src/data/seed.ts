import type { CategoryKind } from '../domain/model';

/** Starter categories, created on first run. Names are user data, in Spanish. */
export const STARTER_CATEGORIES: { name: string; kind: CategoryKind; icon: string; color: string }[] = [
  { name: 'Supermercado', kind: 'expense', icon: 'shopping-cart', color: 'green' },
  { name: 'Restaurantes', kind: 'expense', icon: 'utensils', color: 'orange' },
  { name: 'Transporte', kind: 'expense', icon: 'car', color: 'blue' },
  { name: 'Vivienda', kind: 'expense', icon: 'home', color: 'brown' },
  { name: 'Suministros', kind: 'expense', icon: 'plug', color: 'yellow' },
  { name: 'Salud', kind: 'expense', icon: 'heart-pulse', color: 'red' },
  { name: 'Ocio', kind: 'expense', icon: 'gamepad', color: 'purple' },
  { name: 'Compras', kind: 'expense', icon: 'shopping-bag', color: 'pink' },
  { name: 'Suscripciones', kind: 'expense', icon: 'repeat', color: 'indigo' },
  { name: 'Viajes', kind: 'expense', icon: 'plane', color: 'cyan' },
  { name: 'Educación', kind: 'expense', icon: 'graduation-cap', color: 'teal' },
  { name: 'Regalos', kind: 'expense', icon: 'gift', color: 'rose' },
  { name: 'Comisiones e impuestos', kind: 'expense', icon: 'receipt', color: 'slate' },
  { name: 'Efectivo', kind: 'expense', icon: 'banknote', color: 'lime' },
  { name: 'Otros gastos', kind: 'expense', icon: 'ellipsis', color: 'gray' },
  { name: 'Nómina', kind: 'income', icon: 'briefcase', color: 'green' },
  { name: 'Reembolsos', kind: 'income', icon: 'rotate-ccw', color: 'teal' },
  { name: 'Intereses', kind: 'income', icon: 'percent', color: 'cyan' },
  { name: 'Otros ingresos', kind: 'income', icon: 'piggy-bank', color: 'gray' },
];
