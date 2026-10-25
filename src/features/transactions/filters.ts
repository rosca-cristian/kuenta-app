import { isMonth, type Month } from '../../domain/dates';
import type { TransactionFilter } from '../../data/repository';

/**
 * Movimientos' query parameters, which hold its whole state and which Análisis and Inicio link
 * with: `mes` (YYYY-MM, or `todos` for all months), `q` (the search), `categoria` (a category's
 * id or `sin-categoria`) and `comercio` (a payee's id).
 */
const MONTH = 'mes';
const ALL_MONTHS = 'todos';
const TEXT = 'q';
const CATEGORY = 'categoria';
const PAYEE = 'comercio';
const UNCATEGORIZED = 'sin-categoria';

/** The month in the URL, when it's a valid one. */
export function monthParam(params: URLSearchParams): Month | null {
  const month = params.get(MONTH);
  return month !== null && isMonth(month) ? month : null;
}

/** Movimientos' period in the URL: its month, null for all months, or `fallback` without a valid one. */
export function periodParam(params: URLSearchParams, fallback: Month): Month | null {
  return params.get(MONTH) === ALL_MONTHS ? null : monthParam(params) ?? fallback;
}

/** The search in the URL, as typed; empty without one. */
export function textParam(params: URLSearchParams): string {
  return params.get(TEXT) ?? '';
}

/** The URL's filter, besides the search; null without one. */
export function filterParams(params: URLSearchParams): TransactionFilter | null {
  const category = params.get(CATEGORY);
  const payee = params.get(PAYEE);
  if (category === null && payee === null) return null;
  const filter: TransactionFilter = {};
  if (category !== null) filter.categoryId = category === UNCATEGORIZED ? null : category;
  if (payee !== null) filter.payeeId = payee;
  return filter;
}

/** The URL's parameters with another month, or all months when null, keeping the search and the filter. */
export function withPeriod(params: URLSearchParams, period: Month | null): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(MONTH, period ?? ALL_MONTHS);
  return next;
}

/** The URL's parameters with another search (none when empty), keeping the rest. */
export function withText(params: URLSearchParams, text: string): URLSearchParams {
  const next = new URLSearchParams(params);
  if (text === '') next.delete(TEXT);
  else next.set(TEXT, text);
  return next;
}

/** The URL's parameters without the filter, keeping the period and the search. */
export function withoutFilter(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(CATEGORY);
  next.delete(PAYEE);
  return next;
}

/** A link to Movimientos showing a month, or all months when null, optionally searched and filtered. */
export function transactionsLink(period: Month | null, filter: TransactionFilter = {}): string {
  const params = new URLSearchParams({ [MONTH]: period ?? ALL_MONTHS });
  if (filter.text) params.set(TEXT, filter.text);
  if (filter.categoryId !== undefined) params.set(CATEGORY, filter.categoryId ?? UNCATEGORIZED);
  if (filter.payeeId !== undefined) params.set(PAYEE, filter.payeeId);
  return `/movimientos?${params}`;
}
