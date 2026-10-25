import { Eye, EyeOff } from 'lucide-react';
import { useRepo } from '../lib/repo';
import { usePrivacyMode } from '../lib/money';

/**
 * The eye in Inicio's and Movimientos' header: hides every amount in the app, or shows them
 * again. A toggle with a fixed name, so screen readers say "Ocultar importes, pressed" while hidden.
 */
export function PrivacyButton() {
  const repo = useRepo();
  const hidden = usePrivacyMode();
  return (
    <button
      type="button"
      aria-pressed={hidden}
      aria-label="Ocultar importes"
      className="flex size-11 shrink-0 items-center justify-center text-muted"
      onClick={() => void repo.setPrivacyMode(!hidden)}
    >
      {hidden ? <EyeOff /> : <Eye />}
    </button>
  );
}
