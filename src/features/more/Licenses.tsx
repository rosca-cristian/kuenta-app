import { PageHeader } from '../../ui/components';
import { LIBRARIES } from './about';

/** Más → Licencias: the open-source libraries Kuenta ships, each with its version and licence. */
export function Licenses() {
  return (
    <>
      <PageHeader title="Licencias" back="/mas" />
      <div className="flex flex-col gap-4 px-4 pb-4">
        <p className="text-sm text-muted">
          Kuenta usa estas bibliotecas de código abierto. El texto de cada licencia está en el repositorio de la biblioteca.
        </p>
        <ul aria-label="Bibliotecas" className="overflow-hidden rounded-2xl border border-line bg-card">
          {LIBRARIES.map(({ name, version, license }) => (
            <li key={`${name}@${version}`} className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="break-words">{name}</p>
                <p className="text-sm text-muted">{version}</p>
              </div>
              <span className="shrink-0 text-sm text-muted">{license}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
