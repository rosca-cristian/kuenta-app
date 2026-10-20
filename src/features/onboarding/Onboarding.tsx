import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Landmark, ShieldCheck } from 'lucide-react';
import { Button } from '../../ui/components';
import { useServices } from '../../lib/repo';

/** First run: what Kuenta is, the import account, persistent storage. */
export function Onboarding() {
  const { repo, platform } = useServices();
  const navigate = useNavigate();
  const [step, setStep] = useState<'welcome' | 'account'>('welcome');
  const [name, setName] = useState('BBVA');
  const [saving, setSaving] = useState(false);

  async function finish() {
    setSaving(true);
    await repo.completeOnboarding({ importAccountName: name });
    await platform.requestPersistence().catch(() => false);
    await repo.setPersistRequested();
    navigate('/importar', { replace: true });
  }

  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col justify-between gap-8 px-6 pt-[calc(env(safe-area-inset-top)+3rem)] pb-[calc(env(safe-area-inset-bottom)+2rem)]">
      {step === 'welcome' ? (
        <>
          <div className="flex flex-col gap-4">
            <h1 className="text-3xl font-semibold">Kuenta</h1>
            <p className="text-lg text-muted">Tus finanzas a partir del Excel de tu banco.</p>
            <ul className="mt-4 flex flex-col gap-4 text-sm">
              <li>Una vez a la semana exportas los movimientos de BBVA y los compartes con Kuenta. No apuntas nada a mano.</li>
              <li>Kuenta los categoriza contigo y te enseña en qué se va tu dinero.</li>
              <li className="flex gap-3">
                <ShieldCheck className="shrink-0 text-income" aria-hidden />
                Tus datos solo viven en este móvil: sin cuentas, sin servidores y sin conexión con el banco.
              </li>
            </ul>
          </div>
          <Button onClick={() => setStep('account')}>Empezar</Button>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            <Landmark className="text-accent" size={32} aria-hidden />
            <h1 className="text-2xl font-semibold">Tu cuenta del banco</h1>
            <p className="text-sm text-muted">
              Es la cuenta a la que irán los movimientos que importes. No hace falta el saldo: Kuenta lo calcula con el primer Excel.
            </p>
            <label className="flex flex-col gap-2 text-sm">
              Nombre de la cuenta
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="min-h-12 rounded-xl border border-line bg-card px-4 text-base outline-none focus:border-accent"
              />
            </label>
            <p className="rounded-xl border border-line bg-card-2 p-4 text-sm text-muted">
              Como todo se guarda solo en este móvil, más adelante podrás hacer copias de seguridad para no perder nada si cambias de teléfono.
            </p>
          </div>
          <Button onClick={finish} disabled={saving || name.trim() === ''}>
            Continuar
          </Button>
        </>
      )}
    </main>
  );
}
