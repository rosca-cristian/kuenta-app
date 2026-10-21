/**
 * Dates are local calendar days as 'YYYY-MM-DD' strings and months as 'YYYY-MM'.
 * No time zones are involved anywhere in the domain.
 */
export type IsoDate = string;
export type Month = string;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function isoDate(year: number, month: number, day: number): IsoDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

function isValidDay(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(isoDate(year, month, 1).slice(0, 7));
}

/** Today's date in the device's local time zone. */
export function today(now: Date = new Date()): IsoDate {
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Reads a date from the bank file: "dd/mm/aaaa" text, an Excel serial number
 * (as number or text) or a Date object. Returns null when it isn't a date.
 */
export function parseBankDate(value: unknown): IsoDate | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return isoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{5}(\.\d+)?$/.test(value.trim()))) {
    // Excel serial: days since 1899-12-30.
    const serial = Math.floor(Number(value));
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  if (typeof value !== 'string') return null;

  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return isValidDay(year, month, day) ? isoDate(year, month, day) : null;
}

export function monthOf(date: IsoDate): Month {
  return date.slice(0, 7);
}

export function daysInMonth(month: Month): number {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

export function addMonths(month: Month, count: number): Month {
  const [year, m] = month.split('-').map(Number);
  const index = year * 12 + (m - 1) + count;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
}

/** Whole months from `from` to `to` (positive when `to` is later): 2026-10 → 2027-06 is 8. */
export function monthsBetween(from: Month, to: Month): number {
  const index = (month: Month) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
  return index(to) - index(from);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const toUtc = (d: IsoDate) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function weekday(date: IsoDate): string {
  const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))));
  return WEEKDAYS[d.getUTCDay()];
}

/** "20/10/2026", for tables and CSV. */
export function formatDate(date: IsoDate): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/** "lunes, 20 de octubre", for day headers. */
export function formatDayHeader(date: IsoDate): string {
  return `${weekday(date)}, ${Number(date.slice(8, 10))} de ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

/** "octubre 2026", for the month selector. */
export function formatMonth(month: Month): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}
