import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CircleCheck, FileUp, TriangleAlert } from 'lucide-react';
import { Alert, Amount, Button, Card, PageHeader } from '../../ui/components';
import { Sheet } from '../../ui/Sheet';
import { CategoryGrid } from '../../ui/pickers';
import { TransferBadge } from '../../ui/icons';
import { useServices, useRepoQuery } from '../../lib/repo';
import { Money } from '../../lib/money';
import { formatDate } from '../../domain/dates';
import { suggestedRuleText } from '../../domain/rules';
import { ruleSubjectOf, type ImportWarning, type PlannedRow } from '../../domain/importPlan';
import type { Category, Id, ImportBatch } from '../../domain/model';
import { QuickRuleSheet } from '../rules/QuickRuleSheet';
import type { ImportOutcome, ImportPreview } from '../../data/repository';

type State =
  | { step: 'start'; error?: string }
  | { step: 'reading' }
  | { step: 'preview'; preview: ImportPreview }
  | { step: 'result'; outcome: ImportOutcome };

export function Import() {
  const { repo, platform } = useServices();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<State>({ step: 'start' });
  const takingShared = useRef(false);

  async function open(file: Blob, name: string) {
    setState({ step: 'reading' });
    const result = await repo.previewImport(file, name);
    setState(result.ok ? { step: 'preview', preview: result.preview } : { step: 'start', error: result.error.message });
  }

  // A file shared from another app arrives through the service worker.
  useEffect(() => {
    if (params.get('compartido') !== '1' || takingShared.current) return;
    takingShared.current = true;
    setParams({}, { replace: true });
    void platform.takeSharedFile().then((file) => {
      takingShared.current = false;
      if (file) void open(file, file.name);
      else setState({ step: 'start', error: 'No se ha recibido ningún archivo. Prueba con "Elegir archivo".' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  return (
    <>
      <PageHeader title="Importar" />
      <div className="flex flex-col gap-4 px-4 pb-4">
        {state.step === 'start' && <Start error={state.error} onFile={(file) => open(file, file.name)} />}
        {state.step === 'reading' && <p className="py-16 text-center text-muted">Leyendo el archivo…</p>}
        {state.step === 'preview' && (
          <Preview
            preview={state.preview}
            onCancel={() => setState({ step: 'start' })}
            onImported={(outcome) => setState({ step: 'result', outcome })}
          />
        )}
        {state.step === 'result' && <Result outcome={state.outcome} onDone={() => setState({ step: 'start' })} />}
      </div>
    </>
  );
}

function Start({ error, onFile }: { error?: string; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      {error && (
        <Alert tone="warn">
          <span className="flex gap-2">
            <TriangleAlert size={18} className="shrink-0 text-warn" aria-hidden />
            <span role="alert">{error}</span>
          </span>
        </Alert>
      )}
      <Card>
        <h2 className="mb-2 font-medium">Cómo importar desde BBVA</h2>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted">
          <li>En la app de BBVA, abre tu cuenta y descarga los movimientos.</li>
          <li>Cuando pregunte con qué abrirlo, elige <b className="text-text">Hojas de cálculo</b>.</li>
          <li>
            Toca <b className="text-text">⋮</b> → <b className="text-text">Compartir y exportar</b> → <b className="text-text">Enviar una copia</b> y elige <b className="text-text">Excel (.xlsx)</b>.
          </li>
          <li>
            En el menú de compartir, elige <b className="text-text">Kuenta</b>. Se abrirá la vista previa.
          </li>
        </ol>
        <p className="mt-3 text-xs text-muted">Puedes importar periodos que se solapen: lo ya importado no se duplica.</p>
      </Card>
      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        data-testid="file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
      <Button variant="secondary" onClick={() => input.current?.click()} className="flex items-center justify-center gap-2">
        <FileUp size={18} aria-hidden /> Elegir archivo
      </Button>
      <History />
    </>
  );
}

function warningText(warning: ImportWarning): string[] {
  switch (warning.kind) {
    case 'file-chain-broken':
      return ['Los saldos del archivo no encajan entre sí: parece que le faltan filas.'];
    case 'older-than-opening':
      return [`Hay movimientos anteriores al ${formatDate(warning.oldestExisting)}: el saldo inicial se recalculará.`];
    case 'gaps':
      return warning.gaps.map(
        (gap) => `Faltan movimientos entre el ${formatDate(gap.after)} y el ${formatDate(gap.before)}: importa también ese periodo.`,
      );
  }
}

function Preview({
  preview,
  onCancel,
  onImported,
}: {
  preview: ImportPreview;
  onCancel: () => void;
  onImported: (outcome: ImportOutcome) => void;
}) {
  const { repo } = useServices();
  const categories = useRepoQuery((r) => r.listCategories());
  const accounts = useRepoQuery((r) => r.listAccounts());
  const categoryName = new Map(categories?.map((category) => [category.id, category.name]));
  // Null for no account, so a row that isn't a transfer has no transfer name.
  const accountName = (id: Id | null) => (id === null ? null : (accounts?.find((account) => account.id === id)?.name ?? ''));
  // Re-planned after each rule created from a row.
  const [current, setCurrent] = useState(preview);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // Categories the user chose in the preview, by fingerprint; they win over the rules'.
  const [chosen, setChosen] = useState<Record<string, Id | null>>({});
  // Both kept after their sheet closes, so it doesn't change while it slides away.
  const [editing, setEditing] = useState<PlannedRow | null>(null);
  const [editingOpen, setEditingOpen] = useState(false);
  const [ruleFrom, setRuleFrom] = useState<{ text: string; categoryId: Id | null; transferAccountId: Id | null } | null>(null);
  const [creatingRule, setCreatingRule] = useState(false);
  const [busy, setBusy] = useState(false);
  const fresh = current.plan.rows.filter((row) => row.status === 'new');
  const already = current.plan.rows.length - fresh.length;
  const count = fresh.length - excluded.size;
  const categoryOf = (row: PlannedRow) => (row.hash in chosen ? chosen[row.hash] : row.categoryId);
  // A transfer rule's account, unless the user chose a category, which wins over it.
  const transferOf = (row: PlannedRow) => (row.hash in chosen ? null : row.transferAccountId);
  // The rows a new rule would change: those to import whose category the user didn't choose.
  const ruleCanChange = fresh.filter((row) => !excluded.has(row.hash) && !(row.hash in chosen)).map(ruleSubjectOf);

  function toggle(hash: string) {
    const next = new Set(excluded);
    if (next.has(hash)) next.delete(hash);
    else next.add(hash);
    setExcluded(next);
  }

  function edit(row: PlannedRow) {
    setEditing(row);
    setEditingOpen(true);
  }

  function choose(row: PlannedRow, categoryId: Id | null) {
    // Picking the category a rule already gave the row isn't a change: later rules may still change it.
    // On a row a transfer rule makes a transfer, any category (even "Sin categoría") overrides the rule.
    if (transferOf(row) !== null || categoryId !== categoryOf(row) || row.hash in chosen) setChosen({ ...chosen, [row.hash]: categoryId });
    setEditingOpen(false);
  }

  function createRule(row: PlannedRow) {
    setEditingOpen(false);
    setRuleFrom({ text: suggestedRuleText(row.concept), categoryId: categoryOf(row), transferAccountId: transferOf(row) });
    setCreatingRule(true);
  }

  async function commit() {
    setBusy(true);
    onImported(await repo.commitImport(current, { exclude: [...excluded], categories: chosen }));
  }

  return (
    <>
      <Card>
        <p className="text-sm text-muted">{preview.fileName}</p>
        <p className="font-medium">
          Del {formatDate(preview.plan.dateFrom)} al {formatDate(preview.plan.dateTo)}
        </p>
        <p className="mt-1 text-sm text-muted">
          {fresh.length} nuevos · {already} ya importados
        </p>
      </Card>

      {preview.plan.warnings.flatMap(warningText).map((text) => (
        <Alert key={text} tone="warn">
          {text}
        </Alert>
      ))}

      {fresh.length > 0 ? (
        <section>
          <h2 className="px-1 pb-1 text-sm font-medium">Nuevos ({fresh.length})</h2>
          <ul className="overflow-hidden rounded-2xl border border-line bg-card">
            {fresh.map((row) => {
              const categoryId = categoryOf(row);
              const transferName = accountName(transferOf(row));
              return (
                <li key={row.hash} className="flex min-h-14 items-center border-b border-line last:border-b-0">
                  <input
                    type="checkbox"
                    aria-label={`Importar ${rowName(row)}`}
                    checked={!excluded.has(row.hash)}
                    onChange={() => toggle(row.hash)}
                    className="ml-3 size-5 shrink-0 accent-[var(--color-accent)]"
                  />
                  <button onClick={() => edit(row)} className="flex min-w-0 flex-1 items-center gap-3 self-stretch px-3 py-2 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{rowName(row)}</span>
                      <span className="block truncate text-xs text-muted">
                        <span className={categoryId || transferName !== null ? '' : 'text-warn'} data-testid="preview-category">
                          {transferName !== null
                            ? transferText(row, transferName)
                            : (categoryId && categoryName.get(categoryId)) || 'Sin categoría'}
                        </span>{' '}
                        · {formatDate(row.date)} · {row.movement || row.concept}
                      </span>
                    </span>
                    <Amount cents={row.amount} kind={transferName !== null ? 'neutral' : row.type} />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="px-1 pt-1 text-xs text-muted">Toca una fila para cambiar su categoría o crear una regla.</p>
        </section>
      ) : (
        <Alert>Todo lo de este archivo ya estaba importado.</Alert>
      )}

      {already > 0 && <p className="px-1 text-sm text-muted">Ya importados: {already} (se ignoran)</p>}

      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button className="flex-1" onClick={commit} disabled={busy || count === 0}>
          Importar {count > 0 ? count : ''}
        </Button>
      </div>

      <Sheet open={editingOpen} onClose={() => setEditingOpen(false)} title={editing ? rowName(editing) : ''}>
        {editing && (
          <PreviewRowForm
            row={editing}
            categories={categories ?? []}
            categoryId={categoryOf(editing)}
            transferAccountName={accountName(transferOf(editing))}
            onChoose={(categoryId) => choose(editing, categoryId)}
            onCreateRule={() => createRule(editing)}
          />
        )}
      </Sheet>
      <QuickRuleSheet
        open={creatingRule}
        initialText={ruleFrom?.text ?? ''}
        categoryId={ruleFrom?.categoryId ?? null}
        transferAccountId={ruleFrom?.transferAccountId ?? null}
        pendingRows={ruleCanChange}
        onSaved={async () => setCurrent(await repo.replanImport(current))}
        onClose={() => setCreatingRule(false)}
      />
    </>
  );
}

const rowName = (row: PlannedRow) => row.payeeName || row.note || row.concept;

/** What a transfer rule makes of a row, by the bank's sign: "Transferencia → Revolut" or "Transferencia desde Revolut". */
const transferText = (row: PlannedRow, accountName: string) =>
  row.bankAmount < 0 ? `Transferencia → ${accountName}` : `Transferencia desde ${accountName}`;

/**
 * A new row of the preview: pick its category, or create a rule from its concept. On a row
 * a transfer rule matches (`transferAccountName`), picking a category imports it as an
 * ordinary expense or income instead.
 */
function PreviewRowForm({
  row,
  categories,
  categoryId,
  transferAccountName,
  onChoose,
  onCreateRule,
}: {
  row: PlannedRow;
  categories: Category[];
  categoryId: Id | null;
  transferAccountName: string | null;
  onChoose: (categoryId: Id | null) => void;
  onCreateRule: () => void;
}) {
  // Categories of the row's kind first, as in the edit sheet.
  const ordered = [...categories].sort((a, b) => Number(a.kind !== row.type) - Number(b.kind !== row.type) || a.order - b.order);
  // No rule for a Bizum: it would match every Bizum.
  const canCreateRule = suggestedRuleText(row.concept) !== '';

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <Amount cents={row.amount} kind={transferAccountName !== null ? 'neutral' : row.type} className="text-3xl font-semibold" />
        <p className="mt-1 text-sm text-muted">{formatDate(row.date)}</p>
      </div>

      {transferAccountName !== null && (
        <div className="flex items-center gap-3 rounded-xl bg-card-2 p-3">
          <TransferBadge size={32} />
          <p className="min-w-0 flex-1 text-sm">
            {transferText(row, transferAccountName)}, por una regla. Elige una categoría para importarlo como{' '}
            {row.type === 'expense' ? 'gasto' : 'ingreso'}.
          </p>
        </div>
      )}

      <CategoryGrid categories={ordered} value={transferAccountName !== null ? undefined : categoryId} onPick={onChoose} withNone />

      <div className="rounded-xl bg-card-2 p-3 text-xs text-muted">
        <p>Concepto del banco: {row.concept}</p>
        {row.movement && <p>Movimiento: {row.movement}</p>}
      </div>

      {canCreateRule && (
        <Button variant="secondary" onClick={onCreateRule}>
          Crear regla con este concepto
        </Button>
      )}
    </div>
  );
}

function Result({ outcome, onDone }: { outcome: ImportOutcome; onDone: () => void }) {
  const { repo } = useServices();
  const navigate = useNavigate();
  const check = useRepoQuery((r) => r.balanceCheck()) ?? outcome.check;
  const home = useRepoQuery((r) => r.home(outcome.batch.dateTo.slice(0, 7)));
  const balanced = check.difference === 0;

  return (
    <>
      <Card className="flex flex-col items-center gap-2 text-center">
        {balanced ? (
          <CircleCheck size={40} className="text-income" aria-hidden />
        ) : (
          <TriangleAlert size={40} className="text-warn" aria-hidden />
        )}
        <p className="text-lg font-medium" data-testid="import-created">
          {outcome.batch.created === 1 ? '1 movimiento creado' : `${outcome.batch.created} movimientos creados`}
        </p>
        <dl className="mt-2 grid w-full grid-cols-2 gap-2 text-sm">
          <dt className="text-left text-muted">Saldo en el banco</dt>
          <dd className="text-right tabular-nums"><Money cents={check.bankBalance} /></dd>
          <dt className="text-left text-muted">Saldo en Kuenta</dt>
          <dd className="text-right tabular-nums"><Money cents={check.appBalance} /></dd>
        </dl>
        <p className={`font-medium ${balanced ? 'text-income' : 'text-warn'}`} data-testid="balance-check">
          {balanced ? (
            '✓ Cuadra'
          ) : (
            <>
              No cuadra: diferencia de <Money cents={check.difference} />
            </>
          )}
        </p>
      </Card>

      {!balanced && (
        <>
          {home && home.gaps.length > 0 && (
            <Alert tone="warn">
              Faltan movimientos de algún periodo. Lo mejor es importarlo: el saldo cuadrará solo. Si no puedes, crea un ajuste.
            </Alert>
          )}
          <Button variant="secondary" onClick={() => repo.createBalanceAdjustment()}>
            Crear ajuste de saldo
          </Button>
        </>
      )}

      <Button onClick={() => navigate('/movimientos')}>Ver movimientos</Button>
      <Button variant="ghost" onClick={onDone}>
        Importar otro archivo
      </Button>
    </>
  );
}

function History() {
  const { repo } = useServices();
  const imports = useRepoQuery((r) => r.listImports());
  const [undoing, setUndoing] = useState<{ batch: ImportBatch; edited: number } | null>(null);

  async function askUndo(batch: ImportBatch) {
    setUndoing({ batch, edited: await repo.editedCountInImport(batch.id) });
  }

  async function confirmUndo() {
    if (!undoing) return;
    await repo.undoImport(undoing.batch.id);
    setUndoing(null);
  }

  if (!imports || imports.length === 0) return null;

  return (
    <section>
      <h2 className="px-1 pb-1 text-sm font-medium">Importaciones</h2>
      <ul className="overflow-hidden rounded-2xl border border-line bg-card">
        {imports.map((batch) => (
          <li key={batch.id} className="flex min-h-14 items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
            <span className="min-w-0 flex-1 text-sm">
              <span className="block">
                {formatDate(batch.dateFrom)} – {formatDate(batch.dateTo)}
              </span>
              <span className="block text-xs text-muted">
                Importado el {formatDate(batch.importedAt.slice(0, 10))} · {batch.created} creados
              </span>
            </span>
            {batch.undone ? (
              <span className="text-xs text-muted">Deshecha</span>
            ) : (
              <Button variant="ghost" className="text-sm" onClick={() => askUndo(batch)}>
                Deshacer
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Sheet open={undoing !== null} onClose={() => setUndoing(null)} title="Deshacer importación">
        {undoing && (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              Se borrarán los {undoing.batch.created} movimientos que creó esta importación.
            </p>
            {undoing.edited > 0 && (
              <Alert tone="warn">
                {undoing.edited === 1
                  ? '1 movimiento importado se ha editado desde entonces; se borrará igualmente.'
                  : `${undoing.edited} movimientos importados se han editado desde entonces; se borrarán igualmente.`}
              </Alert>
            )}
            <Button variant="danger" onClick={confirmUndo}>
              Deshacer importación
            </Button>
            <Button variant="secondary" onClick={() => setUndoing(null)}>
              Cancelar
            </Button>
          </div>
        )}
      </Sheet>
    </section>
  );
}
