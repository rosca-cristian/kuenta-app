import { useEffect, useState, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { Alert, Button } from '../../ui/components';
import { useRepo } from '../../lib/repo';
import { hasAction } from '../../domain/rules';
import { normalizeText } from '../../domain/text';
import type { Category, Id, Rule, RuleActions, RuleMatch } from '../../domain/model';
import type { RulePreview } from '../../data/repository';
import { DIRECTION_LABELS, FIELD_LABELS, OP_LABELS, conditionText, movementsText } from './ruleText';

const DEFAULT_MATCH: RuleMatch = { field: 'conceptOrMovement', op: 'contains', value: '', direction: 'any' };

const KIND_GROUPS: { kind: Category['kind']; title: string }[] = [
  { kind: 'expense', title: 'Gastos' },
  { kind: 'income', title: 'Ingresos' },
];

const inputClass = 'min-h-11 rounded-xl border border-line bg-card-2 px-3 text-base text-text outline-none focus:border-accent';

/** A rule's name, shown where the rule is named: its text, tidied. */
const nameFor = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * The counts of a draft rule, refreshed shortly after it stops changing. Null until the
 * first count arrives.
 */
function useRulePreview(match: RuleMatch, actions: RuleActions): RulePreview | null {
  const repo = useRepo();
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const key = JSON.stringify([match, actions]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void repo.previewRule({ match, actions }).then((result) => active && setPreview(result));
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, key]);
  return preview;
}

/**
 * Creates a rule (when `rule` is null) or edits one: "Concepto o movimiento contiene ___"
 * and its actions, with field, operator and direction under "Opciones avanzadas", and a
 * live count of matching transactions. `onSaved` gets how many never-edited transactions
 * applying the saved rule would change.
 */
export function RuleEditor({
  rule,
  categories,
  onSaved,
  onDelete,
}: {
  rule: Rule | null;
  categories: Category[];
  onSaved: (ruleId: Id, applicable: number) => void;
  onDelete: (rule: Rule) => void;
}) {
  const repo = useRepo();
  const [match, setMatch] = useState<RuleMatch>(rule?.match ?? DEFAULT_MATCH);
  // '' stands for no category.
  const [categoryId, setCategoryId] = useState<Id | ''>(rule?.actions.categoryId ?? '');
  const [payeeName, setPayeeName] = useState(rule?.actions.payeeName ?? '');
  const [advanced, setAdvanced] = useState(
    match.field !== DEFAULT_MATCH.field || match.op !== DEFAULT_MATCH.op || match.direction !== DEFAULT_MATCH.direction,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const actions: RuleActions = {};
  if (categoryId) actions.categoryId = categoryId;
  if (payeeName.trim()) actions.payeeName = payeeName;
  const preview = useRulePreview(match, actions);
  const hasText = normalizeText(match.value) !== '';

  const changeMatch = (changes: Partial<RuleMatch>) => {
    setMatch({ ...match, ...changes });
    setError(null);
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!hasText) return setError('Escribe el texto que debe contener.');
    if (!hasAction(actions)) return setError('Elige una categoría o un comercio.');
    setBusy(true);
    let id: Id;
    if (rule) {
      // A rule keeps its name unless its text changes.
      const name = match.value === rule.match.value ? rule.name : nameFor(match.value);
      await repo.updateRule(rule.id, { name, match, actions });
      id = rule.id;
    } else {
      id = await repo.createRule({ name: nameFor(match.value), match, actions });
    }
    const { applicable } = await repo.previewRule({ match, actions });
    onSaved(id, applicable);
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      {rule && !hasAction(rule.actions) && (
        <Alert tone="warn">
          Esta regla está desactivada porque se borró su categoría. Elige una categoría o un comercio para poder activarla.
        </Alert>
      )}

      <label className="flex flex-col gap-1 text-sm text-muted">
        {FIELD_LABELS[match.field]} {OP_LABELS[match.op]}
        <input
          value={match.value}
          autoCapitalize="none"
          onChange={(event) => changeMatch({ value: event.target.value })}
          className={inputClass}
        />
      </label>
      <p data-testid="rule-matches" aria-live="polite" className="-mt-2 text-xs text-muted">
        {!hasText
          ? 'Escribe un texto para ver cuántos movimientos coinciden.'
          : !preview
            ? '…'
            : preview.matching === 0
              ? 'No coincide con ningún movimiento'
              : `Coincide con ${movementsText(preview.matching)}`}
      </p>

      <div>
        <button
          type="button"
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
          className="flex min-h-11 items-center gap-1 text-sm text-accent"
        >
          Opciones avanzadas
          <ChevronDown size={16} className={`transition-transform ${advanced ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {advanced && (
          <div className="flex flex-col gap-3 pt-1">
            <Choice
              legend="Buscar en"
              name="field"
              value={match.field}
              options={FIELD_LABELS}
              onChange={(field) => changeMatch({ field })}
            />
            <Choice
              legend="Condición"
              name="op"
              value={match.op}
              options={{ contains: 'Contiene', startsWith: 'Empieza por', equals: 'Es igual a' }}
              onChange={(op) => changeMatch({ op })}
            />
            <Choice
              legend="Movimientos"
              name="direction"
              value={match.direction}
              options={DIRECTION_LABELS}
              onChange={(direction) => changeMatch({ direction })}
            />
          </div>
        )}
      </div>

      <label className="flex flex-col gap-1 text-sm text-muted">
        Categoría
        <select
          value={categoryId}
          onChange={(event) => {
            setCategoryId(event.target.value);
            setError(null);
          }}
          className={inputClass}
        >
          <option value="">Ninguna</option>
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
      <label className="flex flex-col gap-1 text-sm text-muted">
        Nombre del comercio
        <input
          value={payeeName}
          placeholder="Opcional"
          onChange={(event) => {
            setPayeeName(event.target.value);
            setError(null);
          }}
          className={inputClass}
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {rule ? 'Guardar' : 'Crear regla'}
      </Button>
      {rule && (
        <Button type="button" variant="danger" onClick={() => onDelete(rule)} disabled={busy}>
          Borrar regla
        </Button>
      )}
    </form>
  );
}

/** A row of mutually exclusive options, as segmented buttons. */
function Choice<T extends string>({
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

/** After saving a rule: offers to apply it to the never-edited transactions it would change, and reports how many did. */
export function ApplyOffer({ ruleId, applicable, onDone }: { ruleId: Id; applicable: number; onDone: () => void }) {
  const repo = useRepo();
  const [changed, setChanged] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function apply() {
    setBusy(true);
    setChanged(await repo.applyRules(ruleId));
  }

  if (changed !== null) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="text-sm">
          Regla aplicada: {changed === 1 ? '1 movimiento cambiado' : `${changed} movimientos cambiados`}.
        </p>
        <Button onClick={onDone}>Hecho</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        La regla se aplicará a los próximos movimientos que importes. También puede cambiar {movementsText(applicable)} ya
        importados que no has editado.
      </p>
      <Button onClick={apply} disabled={busy}>
        Aplicar también a {movementsText(applicable)}
      </Button>
      <Button variant="secondary" onClick={onDone} disabled={busy}>
        Ahora no
      </Button>
    </div>
  );
}

export function DeleteRuleForm({ rule, onCancel, onDone }: { rule: Rule; onCancel: () => void; onDone: () => void }) {
  const repo = useRepo();
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    await repo.deleteRule(rule.id);
    onDone();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">¿Borrar la regla {conditionText(rule.match)}?</p>
      <p className="text-sm text-muted">Los movimientos que ya categorizó conservan su categoría. Solo deja de aplicarse a lo que importes después.</p>
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
