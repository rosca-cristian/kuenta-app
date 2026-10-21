import type { Category, Id } from '../../domain/model';
import type { AccountView } from '../../data/repository';

/** What a rule does to a matching row: set a category, or make it a transfer with an account. */
export type ActionKind = 'category' | 'transfer';

const KIND_GROUPS: { kind: Category['kind']; title: string }[] = [
  { kind: 'expense', title: 'Gastos' },
  { kind: 'income', title: 'Ingresos' },
];

const selectClass = 'min-h-11 rounded-xl border border-line bg-card-2 px-3 text-base text-text outline-none focus:border-accent';

/**
 * The accounts a rule can transfer to: the non-imported, non-archived ones, plus the one it
 * already has even when archived, so editing the rule doesn't lose it.
 */
function transferAccountsFor(accounts: AccountView[], current: Id | null): AccountView[] {
  return accounts.filter((account) => !account.isImportAccount && (!account.archived || account.id === current));
}

/**
 * A rule's action: the choice "Categoría" / "Transferencia a cuenta", then the category or
 * the account. `noCategoryLabel` names the empty category option ("Ninguna"); null leaves it out.
 */
export function RuleActionFields({
  kind,
  onKindChange,
  categoryId,
  onCategoryChange,
  accountId,
  onAccountChange,
  categories,
  accounts,
  noCategoryLabel,
}: {
  kind: ActionKind;
  onKindChange: (kind: ActionKind) => void;
  categoryId: Id | null;
  onCategoryChange: (id: Id | null) => void;
  accountId: Id | null;
  onAccountChange: (id: Id | null) => void;
  categories: Category[];
  accounts: AccountView[];
  noCategoryLabel: string | null;
}) {
  const offered = transferAccountsFor(accounts, accountId);
  return (
    <>
      <Choice
        legend="Acción"
        name="action"
        value={kind}
        options={{ category: 'Categoría', transfer: 'Transferencia a cuenta' }}
        onChange={onKindChange}
      />
      {kind === 'category' ? (
        <label className="flex flex-col gap-1 text-sm text-muted">
          Categoría
          <select value={categoryId ?? ''} onChange={(event) => onCategoryChange(event.target.value || null)} className={selectClass}>
            {noCategoryLabel !== null && <option value="">{noCategoryLabel}</option>}
            {KIND_GROUPS.map(({ kind, title }) => (
              <optgroup key={kind} label={title}>
                {categories
                  .filter((category) => category.kind === kind)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      ) : offered.length === 0 ? (
        <p className="text-sm text-muted">No tienes otras cuentas. Créalas en Más → Cuentas.</p>
      ) : (
        <label className="flex flex-col gap-1 text-sm text-muted">
          Cuenta
          <select value={accountId ?? ''} onChange={(event) => onAccountChange(event.target.value || null)} className={selectClass}>
            {accountId === null && <option value="">Elige una cuenta</option>}
            {offered.map((account) => (
              <option key={account.id} value={account.id}>
                {account.archived ? `${account.name} (archivada)` : account.name}
              </option>
            ))}
          </select>
          <span className="text-xs">Un cargo será una transferencia a esta cuenta; un abono, una transferencia desde ella.</span>
        </label>
      )}
    </>
  );
}

/** A row of mutually exclusive options, as segmented buttons. */
export function Choice<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  const entries = Object.entries(options) as [T, string][];
  return (
    <fieldset>
      <legend className="mb-1 text-sm text-muted">{legend}</legend>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}>
        {entries.map(([option, label]) => (
          <label
            key={option}
            className={`relative flex min-h-11 items-center justify-center rounded-xl px-1 text-center text-xs leading-tight ${
              value === option ? 'bg-accent/20 ring-1 ring-accent' : 'bg-card-2'
            }`}
          >
            <input
              type="radio"
              name={name}
              checked={value === option}
              onChange={() => onChange(option)}
              className="absolute inset-0 cursor-pointer appearance-none rounded-xl focus-visible:ring-2 focus-visible:ring-accent"
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
