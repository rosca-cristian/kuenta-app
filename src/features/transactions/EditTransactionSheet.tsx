import { useMemo, useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Amount, Button } from '../../ui/components';
import { CategoryGrid } from '../../ui/pickers';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { formatDate } from '../../domain/dates';
import type { Category, Id } from '../../domain/model';
import type { RuleSuggestion, TransactionView } from '../../data/repository';
import { QuickRuleSheet } from '../rules/QuickRuleSheet';

/** A rule to propose once the edit sheet closes: the suggestion plus what the question shows. */
type Proposal = RuleSuggestion & { categoryId: Id; payeeName: string };

/**
 * Edits the parts of a transaction that belong to the user: category, payee and note.
 * After the user sets a category, it may propose a rule for the payee's other transactions.
 */
export function EditTransactionSheet({ id, onClose }: { id: Id | null; onClose: () => void }) {
  const tx = useRepoQuery((r) => (id ? r.getTransaction(id) : Promise.resolve(null)), [id]);
  // Kept after the proposal closes, so the sheet doesn't change while it slides away.
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposing, setProposing] = useState(false);

  function done(next: Proposal | null) {
    onClose();
    if (next) {
      setProposal(next);
      setProposing(true);
    }
  }

  return (
    <>
      <Sheet open={id !== null} onClose={onClose} title={tx?.source === 'adjustment' ? 'Ajuste de saldo' : 'Movimiento'}>
        {tx && <EditForm key={tx.id} tx={tx} onDone={done} />}
      </Sheet>
      <QuickRuleSheet
        open={proposing}
        initialText={proposal?.text ?? ''}
        categoryId={proposal?.categoryId ?? null}
        question={proposal ? { payeeName: proposal.payeeName, others: proposal.others } : undefined}
        onClose={() => setProposing(false)}
      />
    </>
  );
}

function EditForm({ tx, onDone }: { tx: TransactionView; onDone: (proposal: Proposal | null) => void }) {
  const repo = useRepo();
  const categories = useRepoQuery((r) => r.listCategories());
  const usedThatDay = useRepoQuery((r) => r.expenseCategoriesUsedOn(tx.date), [tx.date]);
  const [categoryId, setCategoryId] = useState<Id | null>(tx.categoryId);
  const [payeeName, setPayeeName] = useState(tx.payee?.name ?? '');
  const [note, setNote] = useState(tx.note);

  // For an incoming amount, the expense categories used that day come first: a friend's
  // Bizum for a shared dinner usually belongs with the dinner.
  const ordered = useMemo(() => {
    if (!categories) return [];
    const rank = (category: Category) => {
      if (tx.type === 'income') {
        const used = (usedThatDay ?? []).indexOf(category.id);
        if (used >= 0) return used;
      }
      return 100 + (category.kind === tx.type ? 0 : 100) + category.order;
    };
    return [...categories].sort((a, b) => rank(a) - rank(b));
  }, [tx.type, categories, usedThatDay]);

  async function save() {
    await repo.updateTransaction(tx.id, { categoryId, payeeName, note });
    onDone(await proposalAfterSave());
  }

  /** A rule to propose for the payee's other transactions; only a newly set category is worth one. */
  async function proposalAfterSave(): Promise<Proposal | null> {
    if (categoryId === null || categoryId === tx.categoryId) return null;
    const suggestion = await repo.ruleSuggestion(tx.id);
    const payee = suggestion && (await repo.getTransaction(tx.id))?.payee;
    return suggestion && payee ? { ...suggestion, categoryId, payeeName: payee.name } : null;
  }

  async function removeAdjustment() {
    await repo.deleteAdjustment(tx.id);
    onDone(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <Amount cents={tx.amount} kind={tx.type === 'income' ? 'income' : 'expense'} className="text-3xl font-semibold" />
        <p className="mt-1 text-sm text-muted">
          {formatDate(tx.date)} · {tx.account.name}
        </p>
      </div>

      {tx.source === 'import' && (
        <>
          <CategoryGrid categories={ordered} value={categoryId} onPick={(id) => setCategoryId(categoryId === id ? null : id)} />

          <label className="flex flex-col gap-1 text-sm text-muted">
            Comercio
            <input
              value={payeeName}
              onChange={(event) => setPayeeName(event.target.value)}
              className="min-h-11 rounded-xl border border-line bg-card-2 px-3 text-base text-text outline-none focus:border-accent"
            />
          </label>
        </>
      )}

      <label className="flex flex-col gap-1 text-sm text-muted">
        Nota
        <textarea
          value={note}
          rows={2}
          onChange={(event) => setNote(event.target.value)}
          className="rounded-xl border border-line bg-card-2 px-3 py-2 text-base text-text outline-none focus:border-accent"
        />
      </label>

      {tx.bankConcept !== null && (
        <div className="rounded-xl bg-card-2 p-3 text-xs text-muted">
          <p>Concepto del banco: {tx.bankConcept}</p>
          {tx.bankMovement && <p>Movimiento: {tx.bankMovement}</p>}
          {tx.bookingDate && tx.bookingDate !== tx.date && <p>Fecha contable: {formatDate(tx.bookingDate)}</p>}
        </div>
      )}

      <Button onClick={save}>Guardar</Button>
      {tx.source === 'adjustment' && (
        <Button variant="danger" onClick={removeAdjustment}>
          Borrar ajuste
        </Button>
      )}
    </div>
  );
}
