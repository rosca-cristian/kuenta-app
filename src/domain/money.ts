/** Money is always handled as integer cents: 12,34 € is 1234. */
export type Cents = number;

const MINUS = '−';

/**
 * Converts an amount from the bank file into cents without going through floats.
 * Accepts the raw cell text written by spreadsheets ("-207.33"), Spanish text
 * ("1.234,56", "-0,5") and plain numbers. Returns null when it isn't an amount.
 */
export function parseBankAmount(value: unknown): Cents | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  }
  if (typeof value !== 'string') return null;

  let text = value.trim().replace(/\s|€/g, '').replace(MINUS, '-');
  if (text === '') return null;

  if (text.includes(',')) {
    // Spanish format: dots group thousands, the comma is the decimal separator.
    text = text.replace(/\./g, '').replace(',', '.');
  }

  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;

  const [, sign, whole, fraction = ''] = match;
  let cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  // Round half away from zero on the third decimal, if any.
  if (fraction.length > 2 && Number(fraction[2]) >= 5) cents += 1;
  return sign === '-' ? -cents : cents;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Formats cents as Spanish euros: 123456 → "1.234,56 €", −500 → "−5,00 €". */
export function formatMoney(cents: Cents): string {
  const abs = Math.abs(cents);
  const euros = groupThousands(String(Math.floor(abs / 100)));
  const rest = String(abs % 100).padStart(2, '0');
  return `${cents < 0 ? MINUS : ''}${euros},${rest} €`;
}

/** Like formatMoney, but always shows the sign: "+12,50 €" or "−12,50 €". */
export function formatSignedMoney(cents: Cents): string {
  return cents > 0 ? `+${formatMoney(cents)}` : formatMoney(cents);
}
