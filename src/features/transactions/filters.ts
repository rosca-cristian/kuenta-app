import { isMonth, type Month } from '../../domain/dates';
import type { TransactionFilter } from '../../data/repository';

/**
 * Movimientos' optional query parameters, which Análisis and Inicio link with:
 * `mes` (YYYY-MM), `categoria` (a category's id or `sin-categoria`) and `comercio` (a payee's id).
 */
const MONTH = 'mes';
const CATEGORY = 'categoria';
const PAYEE = 'comercio';
const UNCATEGORIZED = 'sin-categoria';

/** The month in the URL, when it's a valid one. */
export function monthParam(params: URLSearchParams): Month | null {
  const month = params.get(MONTH);
  return month !== null && isMonth(month) ? month : null;
}

/** The URL's filter; null without one. */
export function filterParams(params: URLSearchParams): TransactionFilter | null {
  const category = params.get(CATEGORY);
  const payee = params.get(PAYEE);
  if (category === null && payee === null) return null;
  const filter: TransactionFilter = {};
  if (category !== null) filter.categoryId = category === UNCATEGORIZED ? null : category;
  if (payee !== null) filter.payeeId = payee;
  return filter;
}

/** The URL's parameters with another month, keeping the filter. */
export function withMonth(params: URLSearchParams, month: Month): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(MONTH, month);
  return next;
}

/** The URL's parameters without the filter, keeping the month. */
export function withoutFilter(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(CATEGORY);
  next.delete(PAYEE);
  return next;
}

/** A link to Movimientos showing a month, optionally filtered. */
export function transactionsLink(month: Month, filter: TransactionFilter = {}): string {
  const params = new URLSearchParams({ [MONTH]: month });
  if (filter.categoryId !== undefined) params.set(CATEGORY, filter.categoryId ?? UNCATEGORIZED);
  if (filter.payeeId !== undefined) params.set(PAYEE, filter.payeeId);
  return `/movimientos?${params}`;
}
