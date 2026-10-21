import type { Account, Category, RuleActions, RuleMatch } from '../../domain/model';

/** Where a rule looks, as the editor's text label starts ("Concepto o movimiento contiene"). */
export const FIELD_LABELS: Record<RuleMatch['field'], string> = {
  conceptOrMovement: 'Concepto o movimiento',
  concept: 'Concepto',
  movement: 'Movimiento',
};

/** How a rule compares, as it reads after the field ("contiene"). */
export const OP_LABELS: Record<RuleMatch['op'], string> = {
  contains: 'contiene',
  startsWith: 'empieza por',
  equals: 'es igual a',
};

export const DIRECTION_LABELS: Record<RuleMatch['direction'], string> = {
  any: 'Ambos',
  out: 'Cargos',
  in: 'Abonos',
};

/** "Concepto o movimiento contiene «mercadona»", with " · solo cargos" or " · solo abonos" when it's limited. */
export function conditionText(match: RuleMatch): string {
  const direction = match.direction === 'out' ? ' · solo cargos' : match.direction === 'in' ? ' · solo abonos' : '';
  return `${FIELD_LABELS[match.field]} ${OP_LABELS[match.op]} «${match.value}»${direction}`;
}

/**
 * "Supermercado · Comercio «Amazon»", or the account a transfer rule moves money with
 * ("Revolut · Comercio «Revolut»"); empty when the rule sets nothing.
 */
export function actionText(actions: RuleActions, categories: Category[], accounts: Account[]): string {
  const parts: string[] = [];
  if (actions.categoryId !== undefined) {
    parts.push(categories.find((category) => category.id === actions.categoryId)?.name ?? 'Categoría borrada');
  }
  if (actions.transferAccountId !== undefined) parts.push(transferAccountName(actions, accounts));
  if (actions.payeeName) parts.push(`Comercio «${actions.payeeName}»`);
  return parts.join(' · ');
}

/** The name of the account a transfer rule moves money with; empty for other rules. */
export function transferAccountName(actions: RuleActions, accounts: Account[]): string {
  if (actions.transferAccountId === undefined) return '';
  return accounts.find((account) => account.id === actions.transferAccountId)?.name ?? 'Cuenta borrada';
}

export const movementsText = (n: number) => (n === 1 ? '1 movimiento' : `${n} movimientos`);
