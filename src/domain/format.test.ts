import { describe, expect, it } from 'vitest';
import { formatMoney, formatSignedMoney, parseBankAmount, parseTypedAmount } from './money';
import { formatDate, formatDayHeader, formatMonth, isMonth, parseBankDate } from './dates';
import { formatPercent } from '../ui/components';

describe('money formatting', () => {
  it('formats cents as Spanish euros, grouping 4-digit thousands', () => {
    expect(formatMoney(123456)).toBe('1.234,56 €');
    expect(formatMoney(-500)).toBe('−5,00 €');
    expect(formatMoney(0)).toBe('0,00 €');
    expect(formatMoney(123456789)).toBe('1.234.567,89 €');
    expect(formatSignedMoney(1250)).toBe('+12,50 €');
  });

  it('reads Spanish text amounts', () => {
    expect(parseBankAmount('1.234,56')).toBe(123456);
    expect(parseBankAmount('-0,5')).toBe(-50);
    expect(parseBankAmount('12,5')).toBe(1250);
    expect(parseBankAmount('-1.325,64')).toBe(-132564);
    expect(parseBankAmount('abc')).toBeNull();
  });

  it('reads amounts the user types, with a decimal comma, grouping dots and a sign', () => {
    expect(parseTypedAmount('500')).toBe(50000);
    expect(parseTypedAmount(' -20,50 ')).toBe(-2050);
    expect(parseTypedAmount('−1.234,56 €')).toBe(-123456);
    expect(parseTypedAmount('1.500')).toBe(150000);
    expect(parseTypedAmount('-1.500.000')).toBe(-150000000);
    expect(parseTypedAmount('12.5')).toBe(1250);
    expect(parseTypedAmount('0,00')).toBe(0);
    expect(parseTypedAmount('')).toBeNull();
    expect(parseTypedAmount('12,3,4')).toBeNull();
  });
});

describe('date formatting', () => {
  it('formats dates for tables, day headers and the month selector', () => {
    expect(formatDate('2026-10-20')).toBe('20/10/2026');
    expect(formatDayHeader('2026-10-20')).toBe('martes, 20 de octubre');
    expect(formatMonth('2026-10')).toBe('octubre 2026');
  });

  it('reads bank dates as text or Excel serial numbers', () => {
    expect(parseBankDate('02/10/2026')).toBe('2026-10-02');
    expect(parseBankDate('31/02/2026')).toBeNull();
    expect(parseBankDate(46297)).toBe('2026-10-02');
  });
});

describe('percent formatting', () => {
  it('rounds down up to 100 % and up above it, so a budget over its limit never reads 100 %', () => {
    expect(formatPercent(84.99)).toBe('84 %');
    expect(formatPercent(100)).toBe('100 %');
    expect(formatPercent(100.01)).toBe('101 %');
    expect(formatPercent(0)).toBe('0 %');
  });
});

describe('months', () => {
  it("recognizes 'YYYY-MM' months", () => {
    expect(isMonth('2026-10')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
    expect(isMonth('2026-1')).toBe(false);
    expect(isMonth('2026-10-01')).toBe(false);
  });
});
