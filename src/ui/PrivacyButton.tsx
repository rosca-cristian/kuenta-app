import { Eye, EyeOff } from 'lucide-react';
import { useRepo } from '../lib/repo';
import { usePrivacyMode } from '../lib/money';

/** The eye in Inicio's and Movimientos' header: hides every amount in the app, or shows them again. */
export function PrivacyButton() {
  const repo = useRepo();
  const hidden = usePrivacyMode();
  return (
    <button
      type="button"
      aria-pressed={hidden}
      aria-label={hidden ? 'Mostrar importes' : 'Ocultar importes'}
      className="flex size-11 shrink-0 items-center justify-center text-muted"
      onClick={() => void repo.setPrivacyMode(!hidden)}
    >
      {hidden ? <EyeOff /> : <Eye />}
    </button>
  );
}
