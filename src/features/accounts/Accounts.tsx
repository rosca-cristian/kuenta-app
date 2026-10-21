import { useState, type FormEvent } from 'react';
import { Alert, Button, PageHeader } from '../../ui/components';
import { Sheet } from '../../ui/Sheet';
import { IconBadge } from '../../ui/icons';
import { ColorPicker, IconPicker } from '../../ui/pickers';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { formatMoney, formatSignedMoney, parseTypedAmount } from '../../domain/money';
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

const countText = (n: number) => (n === 1 ? '1 movimiento' : `${n} movimientos`);

const amountHint = 'Escribe el saldo como un importe, por ejemplo 1.250,50 o -30.';

/**
 * The sheet shows the editor of an account (a new one when `account` is null), its
 * "Actualizar saldo" form, or the confirmation to delete it.
 */
type Editing =
  | { mode: 'edit'; account: AccountView | null }
  | { mode: 'balance'; account: AccountView }
  | { mode: 'delete'; account: AccountView };

const SHEET_TITLES = { balance: 'Actualizar saldo', delete: 'Borrar cuenta' };

/** Más → Cuentas: every account with its balance, to create, edit, update, archive and delete them. */
export function Accounts() {
  const accounts = useRepoQuery((r) => r.listAccounts());
  const [editing, setEditing] = useState<Editing | null>(null);
  const close = () => setEditing(null);
  const edit = (account: AccountView) => setEditing({ mode: 'edit', account });
  const active = accounts?.filter((account) => !account.archived) ?? [];
  const archived = accounts?.filter((account) => account.archived) ?? [];

  return (
    <>
      <PageHeader
        title="Cuentas"
        back="/mas"
        action={
          <Button variant="ghost" onClick={() => setEditing({ mode: 'edit', account: null })}>
            Nueva
          </Button>
        }
      />
      {accounts && (
        <div className="flex flex-col gap-4 px-4 pb-4">
          <AccountList title="Cuentas" accounts={active} onEdit={edit} />
          {archived.length > 0 && (
            <section>
              <h2 className="px-1 pb-1 text-sm font-medium text-muted">Archivadas</h2>
              <AccountList title="Archivadas" accounts={archived} onEdit={edit} />
            </section>
          )}
        </div>
      )}

      <Sheet
        open={editing !== null}
        onClose={close}
        title={!editing ? '' : editing.mode !== 'edit' ? SHEET_TITLES[editing.mode] : editing.account ? 'Editar cuenta' : 'Nueva cuenta'}
      >
        {editing?.mode === 'edit' && (
          <AccountForm
            key={editing.account?.id ?? 'new'}
            account={editing.account}
            onDone={close}
            onUpdateBalance={(account) => setEditing({ mode: 'balance', account })}
            onDelete={(account) => setEditing({ mode: 'delete', account })}
          />
        )}
        {editing?.mode === 'balance' && <BalanceForm key={editing.account.id} account={editing.account} onDone={close} />}
        {editing?.mode === 'delete' && (
          <DeleteForm key={editing.account.id} account={editing.account} onCancel={() => edit(editing.account)} onDone={close} />
        )}
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

function AccountForm({
  account,
  onDone,
  onUpdateBalance,
  onDelete,
}: {
  account: AccountView | null;
  onDone: () => void;
  onUpdateBalance: (account: AccountView) => void;
  onDelete: (account: AccountView) => void;
}) {
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
      const openingBalance = opening.trim() === '' ? 0 : parseTypedAmount(opening);
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

  async function toggleArchived(target: AccountView) {
    await repo.setAccountArchived(target.id, !target.archived);
    onDone();
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
      {/* The import account's balance comes from the bank, and imports always need it. */}
      {account && !isImportAccount && (
        <>
          <Button type="button" variant="secondary" onClick={() => onUpdateBalance(account)}>
            Actualizar saldo
          </Button>
          <Button type="button" variant="secondary" onClick={() => toggleArchived(account)}>
            {account.archived ? 'Desarchivar cuenta' : 'Archivar cuenta'}
          </Button>
          <Button type="button" variant="danger" onClick={() => onDelete(account)}>
            Borrar cuenta
          </Button>
        </>
      )}
    </form>
  );
}

/** "Actualizar saldo": the user types the real balance and Kuenta adds an adjustment for the difference. */
function BalanceForm({ account, onDone }: { account: AccountView; onDone: () => void }) {
  const repo = useRepo();
  const [text, setText] = useState(() => typedAmount(account.balance));
  const [error, setError] = useState<string | null>(null);
  const typed = parseTypedAmount(text);
  const difference = typed === null ? null : typed - account.balance;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (typed === null) {
      setError(amountHint);
      return;
    }
    await repo.updateAccountBalance(account.id, typed);
    onDone();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Saldo en Kuenta de «{account.name}»: <span className="tabular-nums text-text">{formatMoney(account.balance)}</span>
      </p>
      <label className="flex flex-col gap-1 text-sm text-muted">
        Saldo real
        <input
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          inputMode="decimal"
          autoComplete="off"
          className="min-h-11 rounded-xl border border-line bg-card-2 px-3 text-base text-text tabular-nums outline-none focus:border-accent"
        />
      </label>
      {difference !== null && (
        <p className="text-sm text-muted" data-testid="balance-difference">
          {difference === 0
            ? 'Ya coincide: no se creará ningún ajuste.'
            : `Se creará un ajuste de saldo de ${formatSignedMoney(difference)} con fecha de hoy. No cuenta como ingreso ni gasto.`}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit">Actualizar saldo</Button>
    </form>
  );
}

/** Deleting is only for accounts with no transactions; the others are offered archiving instead. */
function DeleteForm({ account, onCancel, onDone }: { account: AccountView; onCancel: () => void; onDone: () => void }) {
  const repo = useRepo();
  const [busy, setBusy] = useState(false);
  const deletable = account.transactionCount === 0;

  async function confirm() {
    setBusy(true);
    if (deletable) await repo.deleteAccount(account.id);
    else await repo.setAccountArchived(account.id, true);
    onDone();
  }

  if (!deletable && account.archived) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          «{account.name}» tiene {countText(account.transactionCount)} y no se puede borrar. Ya está archivada: no aparece en Inicio,
          pero sus movimientos se conservan.
        </p>
        <Button variant="secondary" onClick={onCancel}>
          Volver
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {deletable ? (
        <p className="text-sm">¿Borrar «{account.name}»? No tiene movimientos.</p>
      ) : (
        <Alert tone="warn">
          «{account.name}» tiene {countText(account.transactionCount)} y no se puede borrar. Puedes archivarla: dejará de aparecer en
          Inicio, pero sus movimientos se conservan y su saldo sigue contando en el total.
        </Alert>
      )}
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button variant={deletable ? 'danger' : 'primary'} className="flex-1" onClick={confirm} disabled={busy}>
          {deletable ? 'Borrar' : 'Archivar'}
        </Button>
      </div>
    </div>
  );
}
