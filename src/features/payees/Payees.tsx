import { useState, type FormEvent } from 'react';
import { Alert, Button, EmptyState, PageHeader } from '../../ui/components';
import { Sheet } from '../../ui/Sheet';
import { useRepo, useRepoQuery } from '../../lib/repo';
import type { Id, Payee } from '../../domain/model';
import type { PayeeView } from '../../data/repository';

const countText = (n: number) => (n === 1 ? '1 movimiento' : `${n} movimientos`);

/** Más → Comercios: every payee with its number of transactions, to rename and merge them. */
export function Payees() {
  const payees = useRepoQuery((r) => r.listPayees());
  const [renaming, setRenaming] = useState<PayeeView | null>(null);
  // null while not selecting payees to merge.
  const [selected, setSelected] = useState<Set<Id> | null>(null);
  const [merging, setMerging] = useState(false);

  function toggle(id: Id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  const selectedPayees = (payees ?? []).filter((payee) => selected?.has(payee.id));

  return (
    <>
      <PageHeader
        title="Comercios"
        back="/mas"
        action={
          payees && payees.length > 1 && (
            <Button variant="ghost" onClick={() => setSelected(selected ? null : new Set())}>
              {selected ? 'Cancelar' : 'Seleccionar'}
            </Button>
          )
        }
      />
      {payees && payees.length === 0 && <EmptyState title="Aún no hay comercios">Aparecen al importar movimientos.</EmptyState>}
      {selected && (
        <div className="sticky top-0 z-10 flex items-center gap-3 bg-bg px-4 py-2">
          <p className="flex-1 text-sm text-muted">Elige los comercios que quieres fusionar.</p>
          <Button onClick={() => setMerging(true)} disabled={selected.size < 2}>
            Fusionar{selected.size > 1 ? ` ${selected.size}` : ''}
          </Button>
        </div>
      )}
      {payees && payees.length > 0 && (
        <ul aria-label="Comercios" className="mx-4 mb-4 overflow-hidden rounded-2xl border border-line bg-card">
          {payees.map((payee) => (
            <li key={payee.id} className="border-b border-line last:border-b-0">
              {selected ? (
                <label className="flex min-h-14 items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(payee.id)}
                    onChange={() => toggle(payee.id)}
                    className="size-5 accent-[var(--color-accent)]"
                  />
                  <PayeeLine payee={payee} />
                </label>
              ) : (
                <button className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left active:bg-card-2" onClick={() => setRenaming(payee)}>
                  <PayeeLine payee={payee} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Sheet open={renaming !== null} onClose={() => setRenaming(null)} title="Renombrar comercio">
        {renaming && <RenameForm key={renaming.id} payee={renaming} onDone={() => setRenaming(null)} />}
      </Sheet>
      <Sheet open={merging} onClose={() => setMerging(false)} title="Fusionar comercios">
        {merging && (
          <MergeForm
            payees={selectedPayees}
            onDone={() => {
              setMerging(false);
              setSelected(null);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function PayeeLine({ payee }: { payee: PayeeView }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate">{payee.name}</span>
      <span className="block text-xs text-muted">{countText(payee.transactionCount)}</span>
    </span>
  );
}

function RenameForm({ payee, onDone }: { payee: PayeeView; onDone: () => void }) {
  const repo = useRepo();
  const [name, setName] = useState(payee.name);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Payee | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const result = await repo.renamePayee(payee.id, name);
    if (result.ok) onDone();
    else if (result.reason === 'empty') setError('Escribe un nombre.');
    else setExisting(result.existing);
  }

  async function mergeIntoExisting() {
    if (!existing) return;
    await repo.mergePayees(existing.id, [payee.id]);
    onDone();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-muted">
        Nombre
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
            setExisting(null);
          }}
          className="min-h-11 rounded-xl border border-line bg-card-2 px-3 text-base text-text outline-none focus:border-accent"
        />
      </label>
      <p className="text-xs text-muted">{countText(payee.transactionCount)}</p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {existing ? (
        <>
          <Alert tone="warn">
            <span role="alert">
              {`Ya existe un comercio llamado «${existing.name}». Puedes fusionarlos: los movimientos de «${payee.name}» pasarán a «${existing.name}».`}
            </span>
          </Alert>
          <Button type="button" onClick={mergeIntoExisting}>
            Fusionar con «{existing.name}»
          </Button>
        </>
      ) : (
        <Button type="submit">Guardar</Button>
      )}
    </form>
  );
}

function MergeForm({ payees, onDone }: { payees: PayeeView[]; onDone: () => void }) {
  const repo = useRepo();
  // By default the payee with the most transactions stays.
  const [keepId, setKeepId] = useState<Id>(
    () => payees.reduce((best, payee) => (payee.transactionCount > best.transactionCount ? payee : best), payees[0]).id,
  );

  async function merge() {
    await repo.mergePayees(
      keepId,
      payees.map((payee) => payee.id),
    );
    onDone();
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset>
        <legend className="mb-2 text-sm text-muted">Comercio que se queda</legend>
        <ul className="overflow-hidden rounded-2xl border border-line bg-card-2">
          {payees.map((payee) => (
            <li key={payee.id} className="border-b border-line last:border-b-0">
              <label className="flex min-h-14 items-center gap-3 px-3 py-2">
                <input
                  type="radio"
                  name="keep"
                  checked={keepId === payee.id}
                  onChange={() => setKeepId(payee.id)}
                  className="size-5 accent-[var(--color-accent)]"
                />
                <PayeeLine payee={payee} />
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <p className="text-sm text-muted">
        Los movimientos de los demás pasarán a este comercio y los demás se borrarán. La categoría y la nota de cada movimiento no
        cambian.
      </p>
      <Button onClick={merge}>Fusionar {payees.length} comercios</Button>
    </div>
  );
}
