import type { CategoryKind, RuleMatch } from '../domain/model';

/**
 * Version of the starter data below. An install records the version it has in
 * the `starterDataVersion` setting; on startup the repository adds what newer
 * versions brought. Part 1 installs, which have no setting, are at version 1.
 */
export const STARTER_DATA_VERSION = 2;

/**
 * Starter categories, created on first run. Names are user data, in Spanish.
 * Installs that lack one (by normalized name) get it on the next starter data upgrade.
 */
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
  { name: 'Préstamos', kind: 'expense', icon: 'landmark', color: 'purple' },
  { name: 'Otros gastos', kind: 'expense', icon: 'ellipsis', color: 'gray' },
  { name: 'Nómina', kind: 'income', icon: 'briefcase', color: 'green' },
  { name: 'Reembolsos', kind: 'income', icon: 'rotate-ccw', color: 'teal' },
  { name: 'Intereses', kind: 'income', icon: 'percent', color: 'cyan' },
  { name: 'Prestaciones', kind: 'income', icon: 'hand-coins', color: 'blue' },
  { name: 'Otros ingresos', kind: 'income', icon: 'piggy-bank', color: 'gray' },
];

export interface StarterRule {
  name: string;
  match: RuleMatch;
  /** Name of the starter category the rule sets. */
  category: string;
  payeeName?: string;
  /** The starter data version that brought the rule. */
  since: number;
}

const contains = (value: string): RuleMatch => ({ field: 'conceptOrMovement', op: 'contains', value, direction: 'any' });

/** Starter rules, in order, for common Spanish merchants and bank movements (spec §5.7). */
export const STARTER_RULES: StarterRule[] = [
  { name: 'Mercadona', match: contains('mercadona'), category: 'Supermercado', since: 2 },
  { name: 'Carrefour', match: contains('carrefour'), category: 'Supermercado', since: 2 },
  { name: 'Alcampo', match: contains('alcampo'), category: 'Supermercado', since: 2 },
  { name: 'Lidl', match: contains('lidl'), category: 'Supermercado', since: 2 },
  // Starts with "dia " so that "Media Markt" isn't a supermarket.
  { name: 'Dia', match: { field: 'concept', op: 'startsWith', value: 'dia ', direction: 'any' }, category: 'Supermercado', since: 2 },
  // BBVA writes it "Uber   *eats".
  { name: 'Uber Eats', match: contains('uber *eats'), category: 'Restaurantes', since: 2 },
  { name: 'Glovo', match: contains('glovo'), category: 'Restaurantes', since: 2 },
  { name: 'Just Eat', match: contains('just eat'), category: 'Restaurantes', since: 2 },
  { name: 'Repsol', match: contains('repsol'), category: 'Transporte', since: 2 },
  { name: 'Waylet', match: contains('waylet'), category: 'Transporte', since: 2 },
  { name: 'Cepsa', match: contains('cepsa'), category: 'Transporte', since: 2 },
  { name: 'Gasolinera', match: contains('gasolinera'), category: 'Transporte', since: 2 },
  // Every order carries its own code ("Www.amazon*nv14y8j34"): one payee for all.
  { name: 'Amazon', match: contains('amazon'), category: 'Compras', payeeName: 'Amazon', since: 2 },
  { name: 'Nómina', match: contains('abono de nómina'), category: 'Nómina', since: 2 },
  { name: 'Comisiones', match: contains('comisión'), category: 'Comisiones e impuestos', since: 2 },
  { name: 'Retirada de efectivo', match: contains('retirada'), category: 'Efectivo', since: 2 },
  { name: 'Cajero', match: contains('cajero'), category: 'Efectivo', since: 2 },
];
