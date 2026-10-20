import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Amount, Card, MonthSelector, PageHeader } from '../../ui/components';
import { IconBadge } from '../../ui/icons';
import { useRepoQuery } from '../../lib/repo';
import { formatDate, monthOf, today } from '../../domain/dates';
import { formatMoney } from '../../domain/money';

/** Days without importing before Inicio reminds the user. */
export const IMPORT_REMINDER_DAYS = 8;

export function Home() {
  const navigate = useNavigate();
  const currentMonth = monthOf(today());
  const [month, setMonth] = useState(currentMonth);
  const home = useRepoQuery((repo) => repo.home(month), [month]);

  if (!home) return <PageHeader title="Inicio" />;
  const { summary } = home;

  return (
    <>
      <PageHeader title="Inicio" />
      <div className="flex flex-col gap-4 px-4">
        <Card>
          <p className="text-sm text-muted">Saldo total</p>
          <p className="text-3xl font-semibold tabular-nums" data-testid="total-balance">{formatMoney(home.totalBalance)}</p>
          <div className="mt-3 border-t border-line pt-2">
            <MonthSelector month={month} onChange={setMonth} />
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-muted">Ingresos</dt>
                <dd data-testid="month-income"><Amount cents={summary.income} kind="income" /></dd>
              </div>
              <div>
                <dt className="text-muted">Gastos</dt>
                <dd data-testid="month-expenses"><Amount cents={summary.expenses} /></dd>
              </div>
              <div>
                <dt className="text-muted">Ahorro</dt>
                <dd><Amount cents={summary.savings} /></dd>
                <dd className="text-xs text-muted">
                  {summary.savingsRate === null ? '—' : `${Math.round(summary.savingsRate * 100)} %`}
                </dd>
              </div>
            </dl>
          </div>
        </Card>

        {home.daysSinceLastImport === null ? (
          <Alert tone="warn" onClick={() => navigate('/importar')}>
            Aún no has importado ningún Excel. Toca aquí para empezar.
          </Alert>
        ) : (
          home.daysSinceLastImport >= IMPORT_REMINDER_DAYS && (
            <Alert tone="warn" onClick={() => navigate('/importar')}>
              Han pasado {home.daysSinceLastImport} días desde la última importación.
            </Alert>
          )
        )}
        {home.gaps.map((gap) => (
          <Alert key={`${gap.after}-${gap.before}`} tone="warn" onClick={() => navigate('/importar')}>
            Faltan movimientos entre el {formatDate(gap.after)} y el {formatDate(gap.before)}: importa ese periodo.
          </Alert>
        ))}
        {home.uncategorized > 0 && (
          <Alert onClick={() => navigate('/movimientos')}>
            {home.uncategorized === 1 ? '1 movimiento sin categoría' : `${home.uncategorized} movimientos sin categoría`}
          </Alert>
        )}

        <Card>
          <h2 className="mb-2 font-medium">Cuentas</h2>
          <ul className="flex flex-col gap-3">
            {home.accounts.map((account) => (
              <li key={account.id} className="flex items-center gap-3">
                <IconBadge icon={account.icon} color={account.color} size={36} />
                <span className="flex-1">{account.name}</span>
                <span className="tabular-nums">{formatMoney(account.balance)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
