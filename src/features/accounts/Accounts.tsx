import { useState, type FormEvent } from 'react';
import { Button, PageHeader } from '../../ui/components';
import { Sheet } from '../../ui/Sheet';
import { IconBadge } from '../../ui/icons';
import { ColorPicker, IconPicker } from '../../ui/pickers';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { formatMoney, parseBankAmount } from '../../domain/money';
import type { AccountType } from '../../domain/model';
import type { AccountDraft, AccountSaveResult, AccountView } from '../../data/repository';

const ACCOUNT_TYPES: { type: AccountType; label: string }[] = [
  { type: 'bank', label: 'Banco' },
  { type: 'savings', label: 'Ahorro' },
  { type: 'investment', label: 'Inversión' },
  { type: 'other', label: 'Otra' },
];

const typeLabel = (type: AccountType) => ACCOUNT_TYPES.find((option) => option.type === type)?.label ?? type;

/** Cents as the user would type them back: "−1.234,56" (no currency sign). */
const typedAmount = (cents: number) => formatMoney(cents).replace(/\s*€$/, '');

/** The sheet shows the editor of an account, a new one when `account` is null. */
type Editing = { account: AccountView | null };

/** Más → Cuentas: every account with its balance, to create and edit them. */
export function Accounts() {
  const accounts = useRepoQuery((r) => r.listAccounts());
  const [editing, setEditing] = useState<Editing | null>(null);
  const close = () => setEditing(null);
  const active = accounts?.filter((account) => !account.archived) ?? [];
  const archived = accounts?.filter((account) => account.archived) ?? [];

  return (
    <>
      <PageHeader
        title="Cuentas"
        back="/mas"
        action={
          <Button variant="ghost" onClick={() => setEditing({ account: null })}>
            Nueva
          </Button>
        }
      />
      {accounts && (
        <div className="flex flex-col gap-4 px-4 pb-4">
          <AccountList title="Cuentas" accounts={active} onEdit={(account) => setEditing({ account })} />
          {archived.length > 0 && (
            <section>
              <h2 className="px-1 pb-1 text-sm font-medium text-muted">Archivadas</h2>
              <AccountList title="Archivadas" accounts={archived} onEdit={(account) => setEditing({ account })} />
            </section>
          )}
        </div>
      )}

      <Sheet open={editing !== null} onClose={close} title={editing?.account ? 'Editar cuenta' : 'Nueva cuenta'}>
        {editing && <AccountForm key={editing.account?.id ?? 'new'} account={editing.account} onDone={close} />}
      </Sheet>
    </>
  );
}

function AccountList({ title, accounts, onEdit }: { title: string; accounts: AccountView[]; onEdit: (account: AccountView) => void }) {
  return (
    <ul aria-label={title} className="overflow-hidden rounded-2xl border border-line bg-card">
      {accounts.map((account) => (
        <li key={account.id} className="border-b border-line last:border-b-0">
          <button
            className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left active:bg-card-2"
            onClick={() => onEdit(account)}
          >
            <IconBadge icon={account.icon} color={account.color} size={36} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{account.name}</span>
              <span className="text-xs text-muted">
                {typeLabel(account.type)} · {account.isImportAccount ? 'cuenta de importación' : 'no importada'}
              </span>
            </span>
            <span className="shrink-0 tabular-nums" data-testid="account-balance">
              {formatMoney(account.balance)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function AccountForm({ account, onDone }: { account: AccountView | null; onDone: () => void }) {
  const repo = useRepo();
  const [draft, setDraft] = useState<Omit<AccountDraft, 'openingBalance'>>(
    () => account ?? { name: '', type: 'bank', icon: 'landmark', color: 'blue' },
  );
  // Typed text; empty means 0.
  const [opening, setOpening] = useState(() => (account && account.openingBalance !== 0 ? typedAmount(account.openingBalance) : ''));
  const [error, setError] = useState<string | null>(null);
  const isImportAccount = account?.isImportAccount ?? false;
  const change = (changes: Partial<AccountDraft>) => {
    setDraft({ ...draft, ...changes });
    setError(null);
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const fields: AccountDraft = { name: draft.name, type: draft.type, icon: draft.icon, color: draft.color };
    if (!isImportAccount) {
      const openingBalance = opening.trim() === '' ? 0 : parseBankAmount(opening);
      if (openingBalance === null) {
        setError('Escribe el saldo inicial como un importe, por ejemplo 1.250,50 o -30.');
        return;
      }
      fields.openingBalance = openingBalance;
    }
    const result: AccountSaveResult = account ? await repo.updateAccount(account.id, fields) : await repo.createAccount(fields);
    if (result.ok) onDone();
    else if (result.reason === 'empty') setError('Escribe un nombre.');
    else setError(`Ya existe una cuenta llamada «${result.existing.name}».`);
  }

  const inputClass = 'min-h-11 rounded-xl border border-line bg-card-2 px-3 text-base text-text outline-none focus:border-accent';

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <IconBadge icon={draft.icon} color={draft.color} size={44} />
        <label className="flex flex-1 flex-col gap-1 text-sm text-muted">
          Nombre
          <input value={draft.name} onChange={(event) => change({ name: event.target.value })} className={inputClass} />
        </label>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm text-muted">Tipo</legend>
        <div className="grid grid-cols-4 gap-2">
          {ACCOUNT_TYPES.map(({ type, label }) => (
            <label
              key={type}
              className={`flex min-h-11 items-center justify-center rounded-xl text-sm ${
                draft.type === type ? 'bg-accent/20 ring-1 ring-accent' : 'bg-card-2'
              }`}
            >
              <input type="radio" name="type" className="sr-only" checked={draft.type === type} onChange={() => change({ type })} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {isImportAccount ? (
        <p className="text-sm text-muted">
          Es la cuenta de importación: su saldo inicial sale de los Excel importados.
        </p>
      ) : (
        <label className="flex flex-col gap-1 text-sm text-muted">
          Saldo inicial
          <input
            value={opening}
            onChange={(event) => {
              setOpening(event.target.value);
              setError(null);
            }}
            placeholder="0,00"
            autoComplete="off"
            className={`${inputClass} tabular-nums`}
          />
          <span className="text-xs">Lo que tenía la cuenta antes de su primer movimiento. Puede ser negativo.</span>
        </label>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <IconPicker value={draft.icon} color={draft.color} onChange={(icon) => change({ icon })} />
      <ColorPicker value={draft.color} onChange={(color) => change({ color })} />

      <Button type="submit">{account ? 'Guardar' : 'Crear cuenta'}</Button>
    </form>
  );
}
