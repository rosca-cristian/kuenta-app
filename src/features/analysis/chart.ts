import { formatMonth, type Month } from '../../domain/dates';

/** "oct", for a chart's month axis. */
export const shortMonth = (month: Month) => formatMonth(month).slice(0, 3);

/** The axis labels' style, on the dark background. */
export const AXIS_TICK = { fill: 'var(--color-muted)', fontSize: 11 };
