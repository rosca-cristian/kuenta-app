import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button, EmptyState, PageHeader } from '../../ui/components';
import { Sheet } from '../../ui/Sheet';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { hasAction } from '../../domain/rules';
import type { Category, Id, Rule } from '../../domain/model';
import { ApplyOffer, DeleteRuleForm, RuleEditor } from './RuleEditor';
import { actionText, conditionText } from './ruleText';

/**
 * The sheet shows the editor of a rule (a new one when `rule` is null), the offer to apply
 * a rule just saved to the transactions already imported, or the confirmation to delete it.
 */
type RuleSheet =
  | { mode: 'edit'; rule: Rule | null }
  | { mode: 'apply'; ruleId: Id; applicable: number }
  | { mode: 'delete'; rule: Rule };

const TITLES: Record<RuleSheet['mode'], string> = { edit: 'Editar regla', apply: 'Regla guardada', delete: 'Borrar regla' };

/** Más → Reglas: the rules in the order they're tried, to create, edit, reorder, enable, disable and delete them. */
export function Rules() {
  const rules = useRepoQuery((r) => r.listRules());
  const categories = useRepoQuery((r) => r.listCategories());
  const [sheet, setSheet] = useState<RuleSheet | null>(null);
  const close = () => setSheet(null);

  return (
    <>
      <PageHeader
        title="Reglas"
        back="/mas"
        action={
          <Button variant="ghost" onClick={() => setSheet({ mode: 'edit', rule: null })}>
            Nueva
          </Button>
        }
      />
      {rules && categories && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          <p className="px-1 text-sm text-muted">
            Se aplican al importar, en este orden: gana la primera activa que coincide. Nunca cambian lo que has editado tú.
          </p>
          {rules.length === 0 ? (
            <EmptyState title="Aún no hay reglas">Crea una para categorizar tus movimientos al importarlos.</EmptyState>
          ) : (
            <ul aria-label="Reglas" className="overflow-hidden rounded-2xl border border-line bg-card">
              {rules.map((rule, i) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  categories={categories}
                  first={i === 0}
                  last={i === rules.length - 1}
                  onEdit={() => setSheet({ mode: 'edit', rule })}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      <Sheet
        open={sheet !== null}
        onClose={close}
        title={!sheet ? '' : sheet.mode === 'edit' && !sheet.rule ? 'Nueva regla' : TITLES[sheet.mode]}
      >
        {sheet?.mode === 'edit' && (
          <RuleEditor
            key={sheet.rule?.id ?? 'new'}
            rule={sheet.rule}
            categories={categories ?? []}
            onSaved={(ruleId, applicable) => (applicable > 0 ? setSheet({ mode: 'apply', ruleId, applicable }) : close())}
            onDelete={(rule) => setSheet({ mode: 'delete', rule })}
          />
        )}
        {sheet?.mode === 'apply' && <ApplyOffer key={sheet.ruleId} ruleId={sheet.ruleId} applicable={sheet.applicable} onDone={close} />}
        {sheet?.mode === 'delete' && (
          <DeleteRuleForm
            key={sheet.rule.id}
            rule={sheet.rule}
            onCancel={() => setSheet({ mode: 'edit', rule: sheet.rule })}
            onDone={close}
          />
        )}
      </Sheet>
    </>
  );
}

function RuleRow({
  rule,
  categories,
  first,
  last,
  onEdit,
}: {
  rule: Rule;
  categories: Category[];
  first: boolean;
  last: boolean;
  onEdit: () => void;
}) {
  const repo = useRepo();
  // A rule left without an action (its category was deleted) can't be enabled until it gets one.
  const actionable = hasAction(rule.actions);

  return (
    <li className="flex items-center border-b border-line last:border-b-0">
      <button
        role="switch"
        aria-checked={rule.enabled}
        aria-label={`${rule.name} activa`}
        disabled={!actionable && !rule.enabled}
        onClick={() => void repo.updateRule(rule.id, { enabled: !rule.enabled })}
        className="flex size-11 shrink-0 items-center justify-center disabled:opacity-30"
      >
        <span className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${rule.enabled ? 'bg-accent' : 'bg-line'}`}>
          <span className={`size-5 rounded-full bg-white transition-transform ${rule.enabled ? 'translate-x-4' : ''}`} />
        </span>
      </button>
      <button className="min-h-16 min-w-0 flex-1 py-2 pr-1 text-left active:bg-card-2" onClick={onEdit}>
        <span className={`block text-sm ${rule.enabled ? '' : 'text-muted'}`}>{conditionText(rule.match)}</span>
        {actionable ? (
          <span className="block truncate text-xs text-muted">→ {actionText(rule.actions, categories)}</span>
        ) : (
          <span className="block text-xs text-warn">Necesita una categoría o un comercio</span>
        )}
      </button>
      <button
        aria-label={`Subir ${rule.name}`}
        disabled={first}
        onClick={() => void repo.moveRule(rule.id, 'up')}
        className="flex size-11 shrink-0 items-center justify-center text-muted disabled:opacity-30"
      >
        <ChevronUp size={20} />
      </button>
      <button
        aria-label={`Bajar ${rule.name}`}
        disabled={last}
        onClick={() => void repo.moveRule(rule.id, 'down')}
        className="mr-1 flex size-11 shrink-0 items-center justify-center text-muted disabled:opacity-30"
      >
        <ChevronDown size={20} />
      </button>
    </li>
  );
}
