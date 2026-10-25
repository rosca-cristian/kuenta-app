import type { BudgetStatus } from '../domain/budgets';

/** Each budget status's label and colours, on Presupuestos and Inicio. */
export const BUDGET_STATUS: Record<BudgetStatus, { label: string; text: string; bar: string }> = {
  onTrack: { label: 'En camino', text: 'text-muted', bar: 'bg-accent' },
  near: { label: 'Cerca', text: 'text-warn', bar: 'bg-warn' },
  over: { label: 'Superado', text: 'text-danger', bar: 'bg-danger' },
};
