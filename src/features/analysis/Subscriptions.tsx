import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Card, EmptyState } from '../../ui/components';
import { useRepoQuery } from '../../lib/repo';
import { Money } from '../../lib/money';
import { formatDate } from '../../domain/dates';
import type { SubscriptionFrequency } from '../../domain/subscriptions';
import type { SubscriptionView } from '../../data/repository';
import { transactionsLink } from '../transactions/filters';

const FREQUENCY: Record<SubscriptionFrequency, string> = { monthly: 'Mensual', yearly: 'Anual' };

/** "Mensual (supuesta)" for a single charge: the next one confirms it. */
const frequencyLabel = ({ frequency, assumed }: Pick<SubscriptionView, 'frequency' | 'assumed'>) =>
  frequency === null ? '—' : assumed ? `${FREQUENCY[frequency]} (supuesta)` : FREQUENCY[frequency];

/**
 * Análisis → Suscripciones: every payee with expenses in "Suscripciones", with what it costs
 * per month and per year and what the category spent this month at the top. Tapping a row opens Movimientos with all that payee's
 * transactions, over all months.
 */
export function Subscriptions() {
  const navigate = useNavigate();
  const view = useRepoQuery((repo) => repo.subscriptions(), []);

  if (!view) return null;
  if (view.subscriptions.length === 0) {
    return (
      <EmptyState title="Sin suscripciones">
        Las suscripciones son los comercios con gastos en la categoría «Suscripciones». Pon sus cargos en esa categoría y aparecerán aquí.
      </EmptyState>
    );
  }

  const open = (subscription: SubscriptionView) => navigate(transactionsLink(null, { payeeId: subscription.payeeId }));
  const uncounted = view.subscriptions.some((subscription) => subscription.monthlyAmount === null);

  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <Card>
        <dl className="grid grid-cols-2 gap-2">
          <div>
            <dt className="text-xs text-muted">Al mes</dt>
            <dd className="text-xl font-semibold tabular-nums" data-testid="subscriptions-monthly"><Money cents={view.totals.monthly} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Al año</dt>
            <dd className="text-xl font-semibold tabular-nums" data-testid="subscriptions-yearly"><Money cents={view.totals.yearly} /></dd>
          </div>
        </dl>
        <dl className="mt-3 flex items-baseline justify-between gap-2 border-t border-line pt-3">
          <dt className="text-xs text-muted">Gastado este mes</dt>
          <dd className="font-semibold tabular-nums" data-testid="subscriptions-spent"><Money cents={view.totals.spentThisMonth} /></dd>
        </dl>
        {uncounted && <p className="mt-2 text-xs text-muted">Las de fechas irregulares (—) no cuentan en los totales mensual y anual.</p>}
      </Card>

      <ul aria-label="Suscripciones" className="overflow-hidden rounded-2xl border border-line bg-card">
        {view.subscriptions.map((subscription) => (
          <li key={subscription.payeeId} className="border-b border-line last:border-b-0">
            <button className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left active:bg-card-2" onClick={() => open(subscription)}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">{subscription.payee.name}</span>
                  <span className="shrink-0 tabular-nums" data-testid="subscription-amount"><Money cents={subscription.lastAmount} /></span>
                </div>
                <div className="flex items-baseline justify-between gap-2 text-xs text-muted">
                  <span data-testid="subscription-frequency">{frequencyLabel(subscription)}</span>
                  <span className="tabular-nums" data-testid="subscription-monthly">
                    {subscription.monthlyAmount === null ? (
                      '—'
                    ) : (
                      <>
                        <Money cents={subscription.monthlyAmount} />
                        /mes
                      </>
                    )}
                  </span>
                </div>
                <div className="text-xs text-muted tabular-nums">
                  Último cargo {formatDate(subscription.lastDate)}
                  {subscription.nextDate && ` · Próximo ${formatDate(subscription.nextDate)}`}
                </div>
                {subscription.priceRise && <p className="text-xs text-warn">Ha subido de precio</p>}
                {subscription.missingCharge && <p className="text-xs text-warn">No ha llegado el cargo de este mes</p>}
              </div>
              <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
