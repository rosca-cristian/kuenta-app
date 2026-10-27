import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Amount, Button, Card, MonthSelector, PageHeader, formatPercent } from '../../ui/components';
import { IconBadge, colorFor } from '../../ui/icons';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { Money } from '../../lib/money';
import { PrivacyButton } from '../../ui/PrivacyButton';
import { formatDate, monthOf, today } from '../../domain/dates';
import { BUDGET_STATUS } from '../../ui/budgetStatus';
import type { BudgetView, GoalView } from '../../data/repository';
import { transactionsLink } from '../transactions/filters';
import { RestoredAlert } from '../more/RestoreBackup';

/** Days without importing before Inicio reminds the user. */
export const IMPORT_REMINDER_DAYS = 8;

export function Home() {
  const navigate = useNavigate();
  const currentMonth = monthOf(today());
  const [month, setMonth] = useState(currentMonth);
  const home = useRepoQuery((repo) => repo.home(month), [month]);

  if (!home) return <PageHeader title="Inicio" action={<PrivacyButton />} />;
  const { summary } = home;

  return (
    <>
      <PageHeader title="Inicio" action={<PrivacyButton />} />
      <div className="flex flex-col gap-4 px-4">
        <Card>
          <p className="text-sm text-muted">Saldo total</p>
          <p className="text-3xl font-semibold tabular-nums" data-testid="total-balance"><Money cents={home.totalBalance} /></p>
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
                <dd data-testid="month-savings"><Amount cents={summary.savings} /></dd>
                <dd className="text-xs text-muted" data-testid="month-savings-rate">
                  {summary.savingsRate === null ? '—' : `${Math.round(summary.savingsRate * 100)} %`}
                </dd>
              </div>
            </dl>
            {home.forecast !== null && (
              <p className="mt-2 text-sm text-muted" data-testid="month-forecast">
                A este ritmo gastarás <Money cents={home.forecast} /> este mes
              </p>
            )}
          </div>
        </Card>

        <RestoredAlert />
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
        <StarterRulesOffer />
        {home.uncategorized > 0 && (
          <Alert onClick={() => navigate(transactionsLink(month, { categoryId: null }))}>
            {home.uncategorized === 1 ? '1 movimiento sin categoría' : `${home.uncategorized} movimientos sin categoría`}
          </Alert>
        )}
        {home.budgetsOver > 0 && (
          <Alert tone="warn" onClick={() => navigate('/mas/presupuestos?filtro=superados')}>
            {home.budgetsOver === 1 ? '1 presupuesto superado' : `${home.budgetsOver} presupuestos superados`}
          </Alert>
        )}
        {home.backupDue && (
          <Alert tone="warn" onClick={() => navigate('/mas/copias')}>
            Haz una copia de seguridad
          </Alert>
        )}

        <Card>
          <h2 className="mb-2 font-medium">Cuentas</h2>
          <ul aria-label="Cuentas" className="flex flex-col gap-3">
            {home.accounts.map((account) => (
              <li key={account.id} className="flex items-center gap-3">
                <IconBadge icon={account.icon} color={account.color} size={36} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{account.name}</span>
                  {!account.isImportAccount && <span className="text-xs text-muted">no importada</span>}
                </span>
                <span className="tabular-nums"><Money cents={account.balance} /></span>
              </li>
            ))}
          </ul>
        </Card>
        {home.topBudgets.length > 0 && <TopBudgets budgets={home.topBudgets} />}
        {home.goals.length > 0 && <GoalsProgress goals={home.goals} />}
      </div>
    </>
  );
}

/** The current month's budgets with the highest percentage used, whatever month the card shows. */
function TopBudgets({ budgets }: { budgets: BudgetView[] }) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-medium">Presupuestos</h2>
        <Link to="/mas/presupuestos" className="-my-3 -mr-2 flex min-h-11 items-center px-2 text-sm text-accent">
          Ver todos
        </Link>
      </div>
      <ul aria-label="Presupuestos" className="flex flex-col gap-3">
        {budgets.map(({ category, limit, spent, percent, status }) => (
          <li key={category.id}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{category.name}</span>
              <span className={`shrink-0 tabular-nums ${BUDGET_STATUS[status].text}`} data-testid="budget-spent">
                <Money cents={spent} /> <span className="text-muted">/ <Money cents={limit} /></span>
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={`Gastado en ${category.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, Math.floor(percent))}
              aria-valuetext={`${formatPercent(percent)} · ${BUDGET_STATUS[status].label}`}
              className="mt-1.5 h-2 rounded-full bg-card-2"
            >
              <div className={`h-full rounded-full ${BUDGET_STATUS[status].bar}`} style={{ width: `${Math.min(100, percent)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** A progress bar for each active goal; tapping one opens Objetivos. */
function GoalsProgress({ goals }: { goals: GoalView[] }) {
  return (
    <Card>
      <h2 className="mb-2 font-medium">Objetivos</h2>
      <ul aria-label="Objetivos" className="-mx-2 flex flex-col">
        {goals.map(({ id, name, color, current, target, percent, reached }) => (
          <li key={id}>
            <Link to="/mas/objetivos" className="block rounded-xl px-2 py-1.5 active:bg-card-2">
              <span className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{name}</span>
                {reached ? (
                  <span className="shrink-0 font-medium text-income" data-testid="goal-reached">
                    Conseguido
                  </span>
                ) : (
                  <span className="shrink-0 tabular-nums text-muted" data-testid="goal-percent">
                    {formatPercent(percent)}
                  </span>
                )}
              </span>
              <span className="block text-xs tabular-nums text-muted" data-testid="goal-progress">
                <Money cents={current} /> / <Money cents={target} />
              </span>
              <span
                role="progressbar"
                aria-label={`Progreso de ${name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, Math.floor(percent))}
                aria-valuetext={reached ? 'Conseguido' : formatPercent(percent)}
                className="mt-1.5 block h-2 rounded-full bg-card-2"
              >
                <span
                  className={`block h-full rounded-full ${reached ? 'bg-income' : ''}`}
                  style={{ width: `${reached ? 100 : Math.min(100, percent)}%`, background: reached ? undefined : colorFor(color) }}
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * After the update that brought the starter rules: offers to apply them to the
 * transactions already imported, then says how many changed.
 */
function StarterRulesOffer() {
  const repo = useRepo();
  const offer = useRepoQuery((r) => r.starterRulesOffer());
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState<number | null>(null);

  async function accept() {
    setBusy(true);
    try {
      setChanged(await repo.acceptStarterRulesOffer());
    } finally {
      setBusy(false);
    }
  }

  if (changed !== null) {
    return (
      <Alert onClick={() => setChanged(null)}>
        <span role="status">Reglas de serie aplicadas: {changed === 1 ? '1 movimiento cambiado' : `${changed} movimientos cambiados`}.</span>
      </Alert>
    );
  }
  if (!offer) return null;
  return (
    <Card>
      <p className="text-sm">
        Aplicar las reglas de serie a {offer === 1 ? '1 movimiento ya importado' : `${offer} movimientos ya importados`}
      </p>
      <p className="mt-1 text-xs text-muted">Solo cambian los que no has editado a mano.</p>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => void accept()} disabled={busy}>
          Aplicar
        </Button>
        <Button variant="secondary" onClick={() => void repo.dismissStarterRulesOffer()} disabled={busy}>
          Descartar
        </Button>
      </div>
    </Card>
  );
}
