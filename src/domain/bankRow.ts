import type { Cents } from './money';
import type { IsoDate } from './dates';

/** One row of a bank statement, normalized. */
export interface BankRow {
  valueDate: IsoDate;
  bookingDate: IsoDate;
  concept: string;
  movement: string;
  /** Signed: negative for charges, positive for credits. */
  amount: Cents;
  /** The bank's running balance ("Disponible") right after this row. */
  balance: Cents;
  observations: string;
}
