import { useState, type FormEvent } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/components';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { cleanPayeeName, normalizeText } from '../../domain/text';
import type { Id } from '../../domain/model';
import { ruleMatches, type RuleSubject } from '../../domain/rules';
import type { RulePreview } from '../../data/repository';

export interface QuickRuleSheetProps {
  open: boolean;
  /** The rule text the sheet starts with, e.g. a bank concept cut by the rule suggestion. */
  initialText: string;
  /** The category the rule sets to start with; the user can pick another. Null starts with none. */
  categoryId: Id | null;
  /**
   * When the sheet follows a transaction the user just categorized: its payee and how many
   * other uncategorized transactions it has, to ask "¿Usar siempre Supermercado para Mercadona? (3 más)".
   */
  question?: { payeeName: string; others: number };
  /**
   * Rows not imported yet that saving would also categorize, such as the import preview's
   * rows whose category the user didn't choose: the sheet counts them apart.
   */
  pendingRows?: RuleSubject[];
  /** Called once the rule is created and applied to the transactions the user never edited. */
  onSaved?: (result: { ruleId: Id; applied: number }) => void;
  onClose: () => void;
}

const countText = (n: number) => (n === 1 ? '1 movimiento' : `${n} movimientos`);

/**
 * A quick way to create a rule "concepto o movimiento contiene ___ → categoría", with a live
 * count of the transactions it matches. Saving places the rule before every other one
 * (starter rules included) and applies it to the transactions the user never edited.
 */
export function QuickRuleSheet({
  open,
  initialText,
  categoryId: initialCategoryId,
  question,
  pendingRows,
  onSaved,
  onClose,
}: QuickRuleSheetProps) {
  const repo = useRepo();
  const categories = useRepoQuery((r) => r.listCategories());
  const [text, setText] = useState(initialText);
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [saving, setSaving] = useState(false);

  // Every time the sheet opens, it starts again from what the caller gives it.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setText(initialText);
      setCategoryId(initialCategoryId);
      setSaving(false);
    }
  }

  const hasText = normalizeText(text) !== '';
  const actions = categoryId ? { categoryId } : {};
  const preview = useRepoQuery(
    (r) => (open && hasText ? r.previewRule({ match: { value: text }, actions }) : Promise.resolve(null)),
    [open, text, categoryId],
  );

  const pendingMatches =
    pendingRows && hasText
      ? pendingRows.filter((row) => ruleMatches({ field: 'conceptOrMovement', op: 'contains', direction: 'any', value: text }, row)).length
      : null;

  const category = categories?.find((c) => c.id === categoryId);
  const title = question && category ? `¿Usar siempre ${category.name} para ${question.payeeName}? (${question.others} más)` : 'Crear regla';

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!categoryId || !hasText || saving) return;
    setSaving(true);
    const ruleId = await repo.createRule({ name: cleanPayeeName(text), match: { value: text }, actions: { categoryId } });
    const applied = await repo.applyRules(ruleId);
    onSaved?.({ ruleId, applied });
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-muted">
          Texto de la regla
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            autoCapitalize="none"
            className="min-h-11 rounded-xl border border-line bg-card-2 px-3 text-base text-text outline-none focus:border-accent"
          />
          <span className="text-xs">Se aplica a los movimientos cuyo concepto o movimiento contiene este texto.</span>
        </label>

        <label className="flex flex-col gap-1 text-sm text-muted">
          Categoría
          <select
            value={categoryId ?? ''}
            onChange={(event) => setCategoryId(event.target.value || null)}
            className="min-h-11 rounded-xl border border-line bg-card-2 px-3 text-base text-text outline-none focus:border-accent"
          >
            {categoryId === null && <option value="">Elige una categoría</option>}
            <optgroup label="Gastos">
              {categories?.filter((c) => c.kind === 'expense').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
            <optgroup label="Ingresos">
              {categories?.filter((c) => c.kind === 'income').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          </select>
        </label>

        <p className="text-sm" data-testid="quick-rule-count" aria-live="polite">
          {hasText ? preview && countSentence(preview, categoryId !== null) : 'Escribe el texto que buscará la regla.'}
        </p>
        {pendingMatches !== null && (
          <p className="-mt-2 text-sm" data-testid="quick-rule-pending" aria-live="polite">
            {pendingMatches === 0
              ? 'No coincide con ninguna fila de esta importación.'
              : `En esta importación: ${pendingMatches === 1 ? '1 fila' : `${pendingMatches} filas`}.`}
          </p>
        )}

        <Button type="submit" disabled={!hasText || !categoryId || saving}>
          Crear regla
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          {question ? 'Ahora no' : 'Cancelar'}
        </Button>
      </form>
    </Sheet>
  );
}

function countSentence({ matching, applicable }: RulePreview, withCategory: boolean): string {
  if (matching === 0) return 'No coincide con ningún movimiento.';
  const matches = `Coincide con ${countText(matching)}.`;
  if (!withCategory) return matches;
  return applicable === 0 ? `${matches} No cambiará ninguno.` : `${matches} Se aplicará a ${applicable} que no has editado.`;
}
