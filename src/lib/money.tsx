import { createContext, useContext, type ReactNode } from 'react';
import { moneyFormatters, type MoneyFormatters } from '../domain/money';

const PrivacyContext = createContext(false);

/** Gives the screens privacy mode, from the settings the app loads before its first frame. */
export function PrivacyProvider({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  return <PrivacyContext.Provider value={hidden}>{children}</PrivacyContext.Provider>;
}

/** Whether privacy mode is on. */
export const usePrivacyMode = () => useContext(PrivacyContext);

/**
 * The formatters for every amount on screen, masked to "•••• €" while privacy mode is on.
 * Exports (backup, CSV) use the raw ones in `domain/money` instead.
 */
export const useMoney = (): MoneyFormatters => moneyFormatters(usePrivacyMode());
