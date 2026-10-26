import { createContext, useContext, type ReactNode } from 'react';
import { MASKED_MONEY, moneyFormatters, type Cents, type MoneyFormatters } from '../domain/money';

const PrivacyContext = createContext(false);

/** Gives the screens privacy mode, from the settings the app loads before its first frame. */
export function PrivacyProvider({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  return <PrivacyContext.Provider value={hidden}>{children}</PrivacyContext.Provider>;
}

/** Whether privacy mode is on. */
export const usePrivacyMode = () => useContext(PrivacyContext);

/**
 * The formatters for the amounts that can't be a `Money`, chart axes and tooltips: while
 * privacy mode is on they give the placeholder, which `maskedChartClass` blurs.
 * Exports (backup, CSV) use the raw ones in `domain/money` instead.
 */
export const useMoney = (): MoneyFormatters => moneyFormatters(usePrivacyMode());

/** What a screen reader says for an amount privacy mode hides. */
export const HIDDEN_AMOUNT_LABEL = 'Importe oculto';

/**
 * A chart container's class: in privacy mode, index.css blurs the placeholder on its value
 * axis and in its tooltip. The chart's shape stays.
 */
export const maskedChartClass = (hidden: boolean) => (hidden ? 'masked-chart' : '');

/**
 * An amount on screen. With privacy mode on, the real amount never reaches the page: it shows
 * a fixed placeholder, blurred into a smudge where the amount would be (the `masked-amount`
 * class in index.css), that can't be selected and that screen readers skip for
 * "Importe oculto". Any sign is dropped; the colour given in `className` stays.
 *
 * - `format`: "plain" (1.234,56 €), "signed" (+12,50 € / −12,50 €) or "compact" (1,2 mil €).
 * - `sign`: a "+" or "−" to write before an amount given unsigned, while shown.
 */
export function Money({
  cents,
  format = 'plain',
  sign = '',
  className,
}: {
  cents: Cents;
  format?: 'plain' | 'signed' | 'compact';
  sign?: '' | '+' | '−';
  className?: string;
}) {
  const hidden = usePrivacyMode();
  if (hidden) {
    return (
      <span className={`whitespace-nowrap ${className ?? ''}`} data-testid="hidden-amount">
        <span aria-hidden="true" className="masked-amount">
          {MASKED_MONEY}
        </span>
        <span className="sr-only">{HIDDEN_AMOUNT_LABEL}</span>
      </span>
    );
  }
  const { money, signedMoney, compactMoney } = moneyFormatters(false);
  const text = sign + { plain: money, signed: signedMoney, compact: compactMoney }[format](cents);
  return className === undefined ? text : <span className={className}>{text}</span>;
}
