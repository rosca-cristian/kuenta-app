/** The warning before an action that would leave cash expenses without cash ("Sin efectivo"). */
export const uncoveredWarning = (count: number) =>
  count === 1 ? '1 gasto en efectivo se quedará sin efectivo.' : `${count} gastos en efectivo se quedarán sin efectivo.`;
