import { useMemo, useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Amount, Button } from '../../ui/components';
import { Money } from '../../lib/money';
import { IconBadge, TransferBadge } from '../../ui/icons';
import { AccountPicker, CategoryGrid } from '../../ui/pickers';
import { useRepo, useRepoQuery } from '../../lib/repo';
import { formatDate } from '../../domain/dates';
import { signedAmount, type Category, type Id } from '../../domain/model';
import { shapeByBankSign, transferAccountOf } from '../../domain/transfers';
import type { AccountView, ReimbursementLinkView, RuleSuggestion, TransactionChanges, TransactionView } from '../../data/repository';
import { QuickRuleSheet } from '../rules/QuickRuleSheet';
import { ReimbursementForm } from './ReimbursementForm';
import { transactionTitle } from './titles';

/** A rule to propose once the edit sheet closes: the suggestion plus what the question shows. */
type Proposal = RuleSuggestion & { categoryId: Id; payeeName: string };

/**
 * Edits the parts of a transaction that belong to the user: category, payee, note and
 * whether it's a transfer to another account. After the user sets a category, it may
 * propose a rule for the payee's other transactions. An imported income can be linked to the
 * expenses it pays back ("Es un reembolso"), and either side of a reimbursement opens the other.
 */
export function EditTransactionSheet({ id, onClose }: { id: Id | null; onClose: () => void }) {
  // The transaction shown: the one asked for, or one linked to it the user opened from the sheet.
  const [askedId, setAskedId] = useState(id);
  const [shownId, setShownId] = useState(id);
  // "Es un reembolso" takes over the sheet, keeping the edit form's changes underneath.
  const [linking, setLinking] = useState(false);
  if (id !== askedId) {
    setAskedId(id);
    setShownId(id);
    setLinking(false);
  }
  const tx = useRepoQuery((r) => (shownId ? r.getTransaction(shownId) : Promise.resolve(null)), [shownId]);
  const accounts = useRepoQuery((r) => r.listAccounts());

  function open(next: Id) {
    setShownId(next);
    setLinking(false);
  }
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
      <Sheet
        open={id !== null}
        onClose={onClose}
        title={linking ? '¿Qué gastos te devuelve?' : tx?.source === 'adjustment' ? 'Ajuste de saldo' : 'Movimiento'}
      >
        {tx && accounts && (
          <>
            <div hidden={linking}>
              <EditForm key={tx.id} tx={tx} accounts={accounts} onDone={done} onOpen={open} onLink={() => setLinking(true)} />
            </div>
            {linking && <ReimbursementForm key={tx.id} income={tx} onDone={() => setLinking(false)} />}
          </>
        )}
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

function EditForm({
  tx,
  accounts,
  onDone,
  onOpen,
  onLink,
}: {
  tx: TransactionView;
  accounts: AccountView[];
  onDone: (proposal: Proposal | null) => void;
  /** Opens a transaction linked to this one by a reimbursement. */
  onOpen: (id: Id) => void;
  /** Opens "Es un reembolso" for this income. */
  onLink: () => void;
}) {
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

      {tx.type === 'expense' && tx.reimbursement && (
        <>
          <dl className="grid grid-cols-3 gap-2 rounded-xl bg-card-2 p-3 text-center" data-testid="your-share">
            <div>
              <dt className="text-xs text-muted">Pagado</dt>
              <dd className="tabular-nums"><Money cents={tx.amount} /></dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Te devolvieron</dt>
              <dd className="tabular-nums text-income"><Money cents={tx.reimbursement.paidBack} /></dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Tu parte</dt>
              <dd className="font-semibold tabular-nums"><Money cents={tx.amount - tx.reimbursement.paidBack} /></dd>
            </div>
          </dl>
          <LinkedTransactions title="Te lo devolvieron" links={tx.reimbursement.links} onOpen={onOpen} />
        </>
      )}

      {tx.source === 'import' && tx.type === 'income' && transferTo === null && (
        <div className="flex flex-col gap-2">
          {tx.reimbursement && (
            <>
              <LinkedTransactions title="Reembolso de" links={tx.reimbursement.links} onOpen={onOpen} />
              <p className="text-sm text-muted" data-testid="stays-income">
                Queda como ingreso <Money cents={tx.amount - tx.reimbursement.spread} className="tabular-nums" />
              </p>
            </>
          )}
          <Button variant="secondary" onClick={onLink}>
            {tx.reimbursement ? 'Cambiar reembolso' : 'Es un reembolso'}
          </Button>
        </div>
      )}

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

      {tx.reimbursement && transferTo !== null && (
        <p className="text-sm text-warn" data-testid="reimbursement-goes">
          Se quitará el reembolso
        </p>
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
    <AccountPicker legend={legend} accounts={accounts} onPick={onPick}>
      {accounts.length === 0 && <p className="text-sm text-muted">No tienes otras cuentas. Créalas en Más → Cuentas.</p>}
      <Button variant="ghost" onClick={onCancel}>
        Cancelar
      </Button>
    </AccountPicker>
  );
}

/** The transactions on the other side of a reimbursement, each with its part; tapping one opens its sheet. */
function LinkedTransactions({ title, links, onOpen }: { title: string; links: ReimbursementLinkView[]; onOpen: (id: Id) => void }) {
  const txs = useRepoQuery((r) => Promise.all(links.map((link) => r.getTransaction(link.transactionId))), [links]);
  return (
    <section>
      <h3 className="mb-1 text-sm text-muted">{title}</h3>
      <ul className="overflow-hidden rounded-xl border border-line" aria-label={title}>
        {links.map((link, i) => {
          const linked = txs?.[i];
          return (
            <li key={link.transactionId} className="border-b border-line last:border-b-0">
              <button type="button" className="flex min-h-14 w-full items-center gap-3 bg-card-2 px-3 py-2 text-left active:opacity-70" onClick={() => onOpen(link.transactionId)}>
                <IconBadge icon={linked?.category?.icon} color={linked?.category?.color} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{linked ? transactionTitle(linked) : ''}</span>
                  <span className="block truncate text-xs text-muted">{linked ? formatDate(linked.date) : ''}</span>
                </span>
                <Money cents={link.amount} className="shrink-0 tabular-nums" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
