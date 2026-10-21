import { useMemo, useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Amount, Button } from '../../ui/components';
import { IconBadge, TransferBadge } from '../../ui/icons';
import { CategoryGrid } from '../../ui/pickers';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { formatDate } from '../../domain/dates';
import { signedAmount, type Category, type Id } from '../../domain/model';
import { shapeByBankSign, transferAccountOf } from '../../domain/transfers';
import type { AccountView, RuleSuggestion, TransactionChanges, TransactionView } from '../../data/repository';
import { QuickRuleSheet } from '../rules/QuickRuleSheet';

/** A rule to propose once the edit sheet closes: the suggestion plus what the question shows. */
type Proposal = RuleSuggestion & { categoryId: Id; payeeName: string };

/**
 * Edits the parts of a transaction that belong to the user: category, payee, note and
 * whether it's a transfer to another account. After the user sets a category, it may
 * propose a rule for the payee's other transactions.
 */
export function EditTransactionSheet({ id, onClose }: { id: Id | null; onClose: () => void }) {
  const tx = useRepoQuery((r) => (id ? r.getTransaction(id) : Promise.resolve(null)), [id]);
  const accounts = useRepoQuery((r) => r.listAccounts());
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
        {tx && accounts && <EditForm key={tx.id} tx={tx} accounts={accounts} onDone={done} />}
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

function EditForm({ tx, accounts, onDone }: { tx: TransactionView; accounts: AccountView[]; onDone: (proposal: Proposal | null) => void }) {
  const repo = useRepo();
  const categories = useRepoQuery((r) => r.listCategories());
  const usedThatDay = useRepoQuery((r) => r.expenseCategoriesUsedOn(tx.date), [tx.date]);
  const importAccount = accounts.find((account) => account.isImportAccount)!;
  const savedTransferTo = transferAccountOf(tx, importAccount.id);
  const [categoryId, setCategoryId] = useState<Id | null>(tx.categoryId);
  const [payeeName, setPayeeName] = useState(tx.payee?.name ?? '');
  const [note, setNote] = useState(tx.note);
  const [transferTo, setTransferTo] = useState<Id | null>(savedTransferTo);
  const [pickingAccount, setPickingAccount] = useState(false);

  // What the transaction is with the choices made so far, by the bank's sign on the import account.
  const bankAmount = signedAmount(tx, importAccount.id);
  const shape = tx.source === 'import' ? shapeByBankSign(bankAmount, importAccount.id, transferTo) : tx;
  const kind = shapeByBankSign(bankAmount, importAccount.id, null).type;
  const accountName = (id: Id | null) => accounts.find((account) => account.id === id)?.name ?? '';
  const otherAccounts = accounts.filter((account) => !account.archived && !account.isImportAccount);

  function pickTransferAccount(id: Id | null) {
    setTransferTo(id);
    setCategoryId(null);
    setPickingAccount(false);
  }

  // For an incoming amount, the expense categories used that day come first: a friend's
  // Bizum for a shared dinner usually belongs with the dinner.
  const ordered = useMemo(() => {
    if (!categories) return [];
    const rank = (category: Category) => {
      if (kind === 'income') {
        const used = (usedThatDay ?? []).indexOf(category.id);
        if (used >= 0) return used;
      }
      return 100 + (category.kind === kind ? 0 : 100) + category.order;
    };
    return [...categories].sort((a, b) => rank(a) - rank(b));
  }, [kind, categories, usedThatDay]);

  async function save() {
    const changes: TransactionChanges = { categoryId, payeeName, note };
    if (transferTo !== savedTransferTo) changes.transferAccountId = transferTo;
    await repo.updateTransaction(tx.id, changes);
    onDone(await proposalAfterSave());
  }

  /** A rule to propose for the payee's other transactions; only a newly set category is worth one. */
  async function proposalAfterSave(): Promise<Proposal | null> {
    if (transferTo !== null || categoryId === null || categoryId === tx.categoryId) return null;
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
        <Amount cents={tx.amount} kind={shape.type === 'transfer' ? 'neutral' : shape.type} className="text-3xl font-semibold" />
        <p className="mt-1 text-sm text-muted">
          {formatDate(tx.date)} · {shape.type === 'transfer' ? `${accountName(shape.accountId)} → ${accountName(shape.toAccountId)}` : tx.account.name}
        </p>
      </div>

      {tx.source === 'import' && (
        <>
          {transferTo !== null ? (
            <div className="flex items-center gap-3 rounded-xl bg-card-2 p-3">
              <TransferBadge size={32} />
              <p className="min-w-0 flex-1 text-sm">
                Transferencia {kind === 'expense' ? 'a' : 'desde'} {accountName(transferTo)}
              </p>
              <Button variant="ghost" className="shrink-0 text-sm" onClick={() => pickTransferAccount(null)}>
                Quitar transferencia
              </Button>
            </div>
          ) : (
            <>
              <CategoryGrid categories={ordered} value={categoryId} onPick={(id) => setCategoryId(categoryId === id ? null : id)} />
              {pickingAccount ? (
                <TransferAccountPicker
                  legend={kind === 'expense' ? '¿A qué cuenta va el dinero?' : '¿De qué cuenta viene el dinero?'}
                  accounts={otherAccounts}
                  onPick={pickTransferAccount}
                  onCancel={() => setPickingAccount(false)}
                />
              ) : (
                <Button variant="secondary" onClick={() => setPickingAccount(true)}>
                  Convertir en transferencia
                </Button>
              )}
            </>
          )}

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

/** The other account of a transfer: the active accounts other than the import account. */
function TransferAccountPicker({
  legend,
  accounts,
  onPick,
  onCancel,
}: {
  legend: string;
  accounts: AccountView[];
  onPick: (id: Id) => void;
  onCancel: () => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm text-muted">{legend}</legend>
      {accounts.length === 0 && <p className="text-sm text-muted">No tienes otras cuentas. Créalas en Más → Cuentas.</p>}
      {accounts.map((account) => (
        <button
          key={account.id}
          type="button"
          onClick={() => onPick(account.id)}
          className="flex min-h-11 items-center gap-3 rounded-xl bg-card-2 px-3 py-2 text-left"
        >
          <IconBadge icon={account.icon} color={account.color} size={32} />
          <span className="flex-1">{account.name}</span>
        </button>
      ))}
      <Button variant="ghost" onClick={onCancel}>
        Cancelar
      </Button>
    </fieldset>
  );
}
