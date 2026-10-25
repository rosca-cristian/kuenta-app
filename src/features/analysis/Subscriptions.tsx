import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Card, EmptyState } from '../../ui/components';
import { useRepoQuery } from '../../lib/repo';
import { formatDate, monthOf } from '../../domain/dates';
import { formatMoney } from '../../domain/money';
import type { SubscriptionFrequency } from '../../domain/subscriptions';
import type { SubscriptionView } from '../../data/repository';
import { transactionsLink } from '../transactions/filters';

const FREQUENCY: Record<SubscriptionFrequency, string> = { monthly: 'Mensual', yearly: 'Anual' };

const frequencyLabel = (frequency: SubscriptionFrequency | null) => (frequency === null ? '—' : FREQUENCY[frequency]);

/**
 * Análisis → Suscripciones: every payee with expenses in "Suscripciones", with what it costs
 * per month and per year at the top. Tapping a row opens Movimientos with that payee's
 * transactions, in the month of its last charge.
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

  const open = (subscription: SubscriptionView) =>
    navigate(transactionsLink(monthOf(subscription.lastDate), { payeeId: subscription.payeeId }));
  const uncounted = view.subscriptions.some((subscription) => subscription.monthlyAmount === null);

  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <Card>
        <dl className="grid grid-cols-2 gap-2">
          <div>
            <dt className="text-xs text-muted">Al mes</dt>
            <dd className="text-xl font-semibold tabular-nums" data-testid="subscriptions-monthly">{formatMoney(view.totals.monthly)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Al año</dt>
            <dd className="text-xl font-semibold tabular-nums" data-testid="subscriptions-yearly">{formatMoney(view.totals.yearly)}</dd>
          </div>
        </dl>
        {uncounted && <p className="mt-2 text-xs text-muted">Las que aún no tienen frecuencia (—) no cuentan en los totales.</p>}
      </Card>

      <ul aria-label="Suscripciones" className="overflow-hidden rounded-2xl border border-line bg-card">
        {view.subscriptions.map((subscription) => (
          <li key={subscription.payeeId} className="border-b border-line last:border-b-0">
            <button className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left active:bg-card-2" onClick={() => open(subscription)}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">{subscription.payee.name}</span>
                  <span className="shrink-0 tabular-nums" data-testid="subscription-amount">{formatMoney(subscription.lastAmount)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2 text-xs text-muted">
                  <span data-testid="subscription-frequency">{frequencyLabel(subscription.frequency)}</span>
                  <span className="tabular-nums" data-testid="subscription-monthly">
                    {subscription.monthlyAmount === null ? '—' : `${formatMoney(subscription.monthlyAmount)}/mes`}
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
