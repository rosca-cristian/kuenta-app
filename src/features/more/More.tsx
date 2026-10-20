import { useEffect, useState } from 'react';
import { Card, EmptyState, PageHeader } from '../../ui/components';
import { useRepoQuery, useServices } from '../../lib/repo';

export function More() {
  const { platform } = useServices();
  const accounts = useRepoQuery((repo) => repo.listAccounts());
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => void platform.isPersisted().then(setPersisted), [platform]);
  const importAccount = accounts?.find((account) => account.isImportAccount);

  return (
    <>
      <PageHeader title="Más" />
      <div className="flex flex-col gap-4 px-4">
        <Card>
          <h2 className="mb-2 font-medium">Ajustes</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Cuenta de importación</dt>
            <dd>{importAccount?.name ?? '—'}</dd>
            <dt className="text-muted">Almacenamiento persistente</dt>
            <dd>{persisted === null ? '…' : persisted ? 'Concedido' : 'No concedido'}</dd>
            <dt className="text-muted">Versión</dt>
            <dd>{__APP_VERSION__}</dd>
          </dl>
        </Card>
        <Card>
          <h2 className="mb-1 font-medium">Próximamente</h2>
          <p className="text-sm text-muted">
            Cuentas, categorías, comercios, reglas, presupuestos, objetivos y copias de seguridad.
          </p>
        </Card>
      </div>
    </>
  );
}

export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title="Próximamente">Esta sección llegará en una próxima versión.</EmptyState>
    </>
  );
}
