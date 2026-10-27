import { isMonth, type Month } from '../../domain/dates';
import { TX_TYPE_NAMES } from '../../domain/model';
import type { TransactionFilter } from '../../data/repository';

/**
 * Movimientos' query parameters, which hold its whole state and which Análisis and Inicio link
 * with: `mes` (YYYY-MM, or `todos` for all months), `q` (the search), `cuenta` (an account's id),
 * `categoria` (a category's id or `sin-categoria`), `tipo` (`gasto`, `ingreso`, `transferencia`
 * or `reembolso`) and `comercio` (a payee's id).
 */
const MONTH = 'mes';
const ALL_MONTHS = 'todos';
const TEXT = 'q';
const ACCOUNT = 'cuenta';
const CATEGORY = 'categoria';
const TYPE = 'tipo';
const PAYEE = 'comercio';
const UNCATEGORIZED = 'sin-categoria';
type TypeFilter = NonNullable<TransactionFilter['type']>;
const TYPES: Record<TypeFilter, string> = { expense: 'gasto', income: 'ingreso', transfer: 'transferencia', reimbursement: 'reembolso' };

/** The type filter's options as the filters sheet and the chips name them. */
export const TYPE_FILTER_NAMES: Record<TypeFilter, string> = { ...TX_TYPE_NAMES, reimbursement: 'Reembolsos' };

/** The filter's fields besides the search, each kept in its own parameter. */
export type FilterField = 'accountId' | 'categoryId' | 'type' | 'payeeId';
const FIELD_PARAMS: Record<FilterField, string> = { accountId: ACCOUNT, categoryId: CATEGORY, type: TYPE, payeeId: PAYEE };

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

/** The URL's filter, besides the search (account, category, type and payee); null without one. */
export function filterParams(params: URLSearchParams): TransactionFilter | null {
  const account = params.get(ACCOUNT);
  const category = params.get(CATEGORY);
  const type = (Object.keys(TYPES) as TypeFilter[]).find((key) => TYPES[key] === params.get(TYPE));
  const payee = params.get(PAYEE);
  if (account === null && category === null && type === undefined && payee === null) return null;
  const filter: TransactionFilter = {};
  if (account !== null) filter.accountId = account;
  if (category !== null) filter.categoryId = category === UNCATEGORIZED ? null : category;
  if (type !== undefined) filter.type = type;
  if (payee !== null) filter.payeeId = payee;
  return filter;
}

/** Puts the filter's fields besides the search into `params`, removing those it doesn't have. */
function setFilter(params: URLSearchParams, filter: TransactionFilter) {
  for (const param of Object.values(FIELD_PARAMS)) params.delete(param);
  if (filter.accountId !== undefined) params.set(ACCOUNT, filter.accountId);
  if (filter.categoryId !== undefined) params.set(CATEGORY, filter.categoryId ?? UNCATEGORIZED);
  if (filter.type !== undefined) params.set(TYPE, TYPES[filter.type]);
  if (filter.payeeId !== undefined) params.set(PAYEE, filter.payeeId);
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

/** The URL's parameters with another filter besides the search, keeping the period and the search. */
export function withFilter(params: URLSearchParams, filter: TransactionFilter): URLSearchParams {
  const next = new URLSearchParams(params);
  setFilter(next, filter);
  return next;
}

/** The URL's parameters without one field of the filter, or without all of them, keeping the period and the search. */
export function withoutFilter(params: URLSearchParams, field?: FilterField): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const param of field ? [FIELD_PARAMS[field]] : Object.values(FIELD_PARAMS)) next.delete(param);
  return next;
}

/** A link to Movimientos showing a month, or all months when null, optionally searched and filtered. */
export function transactionsLink(period: Month | null, filter: TransactionFilter = {}): string {
  const params = new URLSearchParams({ [MONTH]: period ?? ALL_MONTHS });
  if (filter.text) params.set(TEXT, filter.text);
  setFilter(params, filter);
  return `/movimientos?${params}`;
}
