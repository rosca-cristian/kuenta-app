import { useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Alert, Button, PageHeader } from '../../ui/components';
import { Sheet } from '../../ui/Sheet';
import { IconBadge, ICON_NAMES } from '../../ui/icons';
import { ColorPicker, IconPicker } from '../../ui/pickers';
import { useRepo, useRepoQuery } from '../../lib/repo';
import type { Category, CategoryKind, Id } from '../../domain/model';
import type { CategoryDraft, CategorySaveResult } from '../../data/repository';
import { isNextMonthDay } from '../../domain/countingMonth';

const KINDS: { kind: CategoryKind; label: string; title: string }[] = [
  { kind: 'expense', label: 'Gasto', title: 'Gastos' },
  { kind: 'income', label: 'Ingreso', title: 'Ingresos' },
];

const countText = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** The day "A partir del día" proposes when the setting is turned on: the last week of the month, when salaries tend to arrive. */
const DEFAULT_NEXT_MONTH_DAY = 25;

/** The sheet shows either the editor of a category (a new one when `category` is null) or the confirmation to delete it. */
type Editing = { mode: 'edit'; category: Category | null } | { mode: 'delete'; category: Category };

/** Más → Categorías: categories by kind and in order, to create, edit, reorder and delete them. */
export function Categories() {
  const repo = useRepo();
  const categories = useRepoQuery((r) => r.listCategories());
  const [editing, setEditing] = useState<Editing | null>(null);
  const close = () => setEditing(null);

  return (
    <>
      <PageHeader
        title="Categorías"
        back="/mas"
        action={
          <Button variant="ghost" onClick={() => setEditing({ mode: 'edit', category: null })}>
            Nueva
          </Button>
        }
      />
      {categories && (
        <div className="flex flex-col gap-4 px-4 pb-4">
          {KINDS.map(({ kind, title }) => {
            const ofKind = categories.filter((category) => category.kind === kind);
            return (
              <section key={kind}>
                <h2 className="px-1 pb-1 text-sm font-medium text-muted">{title}</h2>
                {ofKind.length === 0 ? (
                  <p className="rounded-2xl border border-line bg-card px-4 py-3 text-sm text-muted">Sin categorías.</p>
                ) : (
                  <ul aria-label={title} className="overflow-hidden rounded-2xl border border-line bg-card">
                    {ofKind.map((category, i) => (
                      <li key={category.id} className="flex items-center border-b border-line last:border-b-0">
                        <button
                          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left active:bg-card-2"
                          onClick={() => setEditing({ mode: 'edit', category })}
                        >
                          <IconBadge icon={category.icon} color={category.color} size={36} />
                          <span className="truncate">{category.name}</span>
                        </button>
                        <button
                          aria-label={`Subir ${category.name}`}
                          disabled={i === 0}
                          onClick={() => void repo.moveCategory(category.id, 'up')}
                          className="flex size-11 shrink-0 items-center justify-center text-muted disabled:opacity-30"
                        >
                          <ChevronUp size={20} />
                        </button>
                        <button
                          aria-label={`Bajar ${category.name}`}
                          disabled={i === ofKind.length - 1}
                          onClick={() => void repo.moveCategory(category.id, 'down')}
                          className="mr-1 flex size-11 shrink-0 items-center justify-center text-muted disabled:opacity-30"
                        >
                          <ChevronDown size={20} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Sheet
        open={editing !== null}
        onClose={close}
        title={!editing ? '' : editing.mode === 'delete' ? 'Borrar categoría' : editing.category ? 'Editar categoría' : 'Nueva categoría'}
      >
        {editing?.mode === 'edit' && (
          <CategoryForm
            key={editing.category?.id ?? 'new'}
            category={editing.category}
            onDone={close}
            onDelete={(category) => setEditing({ mode: 'delete', category })}
          />
        )}
        {editing?.mode === 'delete' && (
          <DeleteForm
            key={editing.category.id}
            category={editing.category}
            categories={categories ?? []}
            onCancel={() => setEditing({ mode: 'edit', category: editing.category })}
            onDone={close}
          />
        )}
      </Sheet>
    </>
  );
}

function CategoryForm({
  category,
  onDone,
  onDelete,
}: {
  category: Category | null;
  onDone: () => void;
  onDelete: (category: Category) => void;
}) {
  const repo = useRepo();
  const [draft, setDraft] = useState<CategoryDraft>(
    () => category ?? { name: '', kind: 'expense', icon: ICON_NAMES[0], color: 'blue' },
  );
  const [error, setError] = useState<string | null>(null);
  // Income categories: whether a late income counts in the next month, and from which day, as typed.
  const [late, setLate] = useState(category?.nextMonthFromDay != null);
  const [day, setDay] = useState(String(category?.nextMonthFromDay ?? DEFAULT_NEXT_MONTH_DAY));
  const [dayError, setDayError] = useState<string | null>(null);
  const change = (changes: Partial<CategoryDraft>) => {
    setDraft({ ...draft, ...changes });
    setError(null);
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const counted = draft.kind === 'income' && late;
    if (counted && !(/^\d{1,2}$/.test(day.trim()) && isNextMonthDay(Number(day)))) {
      setDayError('Escribe un día del 1 al 31.');
      return;
    }
    // Only an income category counts late incomes in the next month; an expense one is saved with it off.
    const fields = { name: draft.name, kind: draft.kind, icon: draft.icon, color: draft.color, nextMonthFromDay: counted ? Number(day) : null };
    const result: CategorySaveResult = category ? await repo.updateCategory(category.id, fields) : await repo.createCategory(fields);
    if (result.ok) onDone();
    else if (result.reason === 'empty') setError('Escribe un nombre.');
    else setError(`Ya existe una categoría llamada «${result.existing.name}».`);
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <IconBadge icon={draft.icon} color={draft.color} size={44} />
        <label className="flex flex-1 flex-col gap-1 text-sm text-muted">
          Nombre
          <input
            value={draft.name}
            onChange={(event) => change({ name: event.target.value })}
            className="min-h-11 rounded-xl border border-line bg-card-2 px-3 text-base text-text outline-none focus:border-accent"
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <fieldset>
        <legend className="mb-2 text-sm text-muted">Tipo</legend>
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map(({ kind, label }) => (
            <label
              key={kind}
              className={`flex min-h-11 items-center justify-center rounded-xl text-sm ${
                draft.kind === kind ? 'bg-accent/20 ring-1 ring-accent' : 'bg-card-2'
              }`}
            >
              <input type="radio" name="kind" className="sr-only" checked={draft.kind === kind} onChange={() => change({ kind })} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {draft.kind === 'income' && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={late}
            onClick={() => {
              setLate(!late);
              setDayError(null);
            }}
            className="flex min-h-11 items-center gap-3 text-left text-sm"
          >
            <span className={`flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors ${late ? 'bg-accent' : 'bg-line'}`}>
              <span className={`size-5 rounded-full bg-white transition-transform ${late ? 'translate-x-4' : ''}`} />
            </span>
            Contar en el mes siguiente si llega tarde
          </button>
          {late && (
            <label className="flex flex-col gap-1 text-sm text-muted">
              A partir del día
              <input
                inputMode="numeric"
                value={day}
                aria-invalid={dayError !== null}
                onChange={(event) => {
                  setDay(event.target.value.trim());
                  setDayError(null);
                }}
                className="min-h-11 w-24 rounded-xl border border-line bg-card-2 px-3 text-base tabular-nums text-text outline-none focus:border-accent"
              />
            </label>
          )}
          {dayError && (
            <p role="alert" className="text-sm text-danger">
              {dayError}
            </p>
          )}
          <span className="text-xs text-muted">
            Una nómina que llega a partir de ese día cuenta como ingreso del mes siguiente en Inicio y Análisis. Movimientos y los saldos siguen con la
            fecha del banco.
          </span>
        </div>
      )}

      <IconPicker value={draft.icon} color={draft.color} onChange={(icon) => change({ icon })} />
      <ColorPicker value={draft.color} onChange={(color) => change({ color })} />

      <Button type="submit">{category ? 'Guardar' : 'Crear categoría'}</Button>
      {category && (
        <Button type="button" variant="danger" onClick={() => onDelete(category)}>
          Borrar categoría
        </Button>
      )}
    </form>
  );
}

function DeleteForm({
  category,
  categories,
  onCancel,
  onDone,
}: {
  category: Category;
  categories: Category[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const repo = useRepo();
  const usage = useRepoQuery((r) => r.categoryUsage(category.id), [category.id]);
  // '' stands for "Sin categoría".
  const [moveTo, setMoveTo] = useState<Id | ''>('');
  const [busy, setBusy] = useState(false);
  const others = categories.filter((other) => other.id !== category.id);

  async function remove() {
    setBusy(true);
    await repo.deleteCategory(category.id, moveTo || null);
    onDone();
  }

  if (!usage) return null;

  return (
    <div className="flex flex-col gap-4">
      {usage.transactions > 0 ? (
        <>
          <p className="text-sm">
            «{category.name}» tiene {countText(usage.transactions, 'movimiento', 'movimientos')}. Elige a dónde pasan.
          </p>
          <label className="flex flex-col gap-1 text-sm text-muted">
            Mover movimientos a
            <select
              value={moveTo}
              onChange={(event) => setMoveTo(event.target.value)}
              className="min-h-11 rounded-xl border border-line bg-card-2 px-3 text-base text-text outline-none focus:border-accent"
            >
              <option value="">Sin categoría</option>
              {KINDS.map(({ kind, title }) => (
                <optgroup key={kind} label={title}>
                  {others
                    .filter((other) => other.kind === kind)
                    .map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
        </>
      ) : (
        <p className="text-sm">¿Borrar «{category.name}»? No tiene movimientos.</p>
      )}
      {usage.rules > 0 && (
        <Alert tone="warn">
          {usage.rules === 1
            ? 'La regla que asigna esta categoría se desactivará, para que puedas cambiarla después.'
            : `Las ${usage.rules} reglas que asignan esta categoría se desactivarán, para que puedas cambiarlas después.`}
        </Alert>
      )}
      {usage.budget && <Alert tone="warn">También se borrará su presupuesto, incluido el de meses anteriores.</Alert>}
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button variant="danger" className="flex-1" onClick={remove} disabled={busy}>
          Borrar
        </Button>
      </div>
    </div>
  );
}
