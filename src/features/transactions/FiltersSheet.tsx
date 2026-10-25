import { useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button, Choice } from '../../ui/components';
import { AccountPicker, CategoryGrid } from '../../ui/pickers';
import { useRepoQuery } from '../../lib/repo';
import { TX_TYPE_NAMES, type Account, type Category, type TxType } from '../../domain/model';
import type { TransactionFilter } from '../../data/repository';

/** What the sheet sets; the payee comes from Análisis and only its chip removes it. */
export type SheetFilter = Pick<TransactionFilter, 'accountId' | 'categoryId' | 'type'>;

const TYPE_OPTIONS: Record<TxType | 'all', string> = { all: 'Todos', ...TX_TYPE_NAMES };

/** Archived ones after the active ones, each in their own order. */
const activeFirst = <T extends Account | Category>(items: T[]) => [...items.filter((item) => !item.archived), ...items.filter((item) => item.archived)];

/**
 * Movimientos' "Filtros": account, category ("Sin categoría" included) and type, starting from
 * the current ones; "Aplicar" hands them on. Tapping the picked account or category again
 * unpicks it.
 */
export function FiltersSheet({
  open,
  filter,
  onApply,
  onClose,
}: {
  open: boolean;
  filter: SheetFilter;
  onApply: (filter: SheetFilter) => void;
  onClose: () => void;
}) {
  const accounts = useRepoQuery((r) => r.listAccounts());
  const categories = useRepoQuery((r) => r.listCategories({ withArchived: true }));
  // Each opening starts again from the current filter.
  const [opened, setOpened] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpened(opened + 1);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Filtros">
      {accounts && categories && (
        <FiltersForm key={opened} filter={filter} accounts={activeFirst(accounts)} categories={activeFirst(categories)} onApply={onApply} />
      )}
    </Sheet>
  );
}

function FiltersForm({
  filter,
  accounts,
  categories,
  onApply,
}: {
  filter: SheetFilter;
  accounts: Account[];
  categories: Category[];
  onApply: (filter: SheetFilter) => void;
}) {
  const [accountId, setAccountId] = useState(filter.accountId);
  const [categoryId, setCategoryId] = useState(filter.categoryId);
  const [type, setType] = useState(filter.type);

  return (
    <div className="flex flex-col gap-4">
      <Choice
        legend="Tipo"
        name="type"
        value={type ?? 'all'}
        options={TYPE_OPTIONS}
        onChange={(choice) => setType(choice === 'all' ? undefined : choice)}
      />
      <AccountPicker legend="Cuenta" accounts={accounts} value={accountId} onPick={(id) => setAccountId(accountId === id ? undefined : id)} />
      <CategoryGrid
        categories={categories}
        value={categoryId}
        withNone
        onPick={(id) => setCategoryId(categoryId === id ? undefined : id)}
      />
      <Button onClick={() => onApply({ accountId, categoryId, type })}>Aplicar</Button>
    </div>
  );
}
