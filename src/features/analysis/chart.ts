import { formatMonth, type Month } from '../../domain/dates';

/** "oct", for a chart's month axis. */
export const shortMonth = (month: Month) => formatMonth(month).slice(0, 3);

/** The axis labels' style, on the dark background. */
export const AXIS_TICK = { fill: 'var(--color-muted)', fontSize: 11 };

/**
 * The value axis' labels: Recharts wraps a label wider than the axis, and a wider box keeps
 * "1,2 mil €", or privacy mode's placeholder, on one line.
 */
export const VALUE_AXIS_TICK = { ...AXIS_TICK, width: 120 };
