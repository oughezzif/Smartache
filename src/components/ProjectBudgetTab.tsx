import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  FilePlus2,
  Lock,
  Plus,
  Receipt,
  Upload,
  XCircle,
} from 'lucide-react';
import { api, type WorkspaceSnapshot } from '../services/api';
import { formatAmountMAD, formatDateFR } from '../shared/calculationEngine';
import type { Project } from '../shared/types';

interface ProjectBudgetTabProps {
  project: Project;
  snapshot: WorkspaceSnapshot;
  onRefresh: () => void;
}

export const ProjectBudgetTab: React.FC<ProjectBudgetTabProps> = ({
  project,
  snapshot,
  onRefresh,
}) => {
  const user = snapshot.currentUser;
  const todayISO = snapshot.effectiveTodayISO;
  const canSeeAmounts = user.role !== 'responsable' || project.showAmountsToResponsable;
  const canManageFinances = user.role === 'responsable_achat' || user.role === 'directeur';
  const isDirector = user.role === 'directeur';

  const [error, setError] = useState('');
  const [newLines, setNewLines] = useState<{ category: string; designation: string; plannedAmount: string }[]>([
    { category: 'Équipements', designation: '', plannedAmount: '' },
  ]);
  const [revReason, setRevReason] = useState('');

  // PO creation
  const [poNumber, setPoNumber] = useState('');
  const [poDate, setPoDate] = useState(todayISO);
  const [poLineId, setPoLineId] = useState('');
  const [poSupplierId, setPoSupplierId] = useState(
    snapshot.suppliers.find((s) => s.status === 'qualifie')?.id || ''
  );
  const [poAmountHT, setPoAmountHT] = useState('');
  const [poVat, setPoVat] = useState<0 | 7 | 10 | 14 | 20>(20);
  const [poFile, setPoFile] = useState<File | null>(null);
  const [cancelPoId, setCancelPoId] = useState<string | null>(null);
  const [cancelPoReason, setCancelPoReason] = useState('');

  // Invoice / Credit note creation
  const [invOrderId, setInvOrderId] = useState('');
  const [invType, setInvType] = useState<'facture' | 'avoir'>('facture');
  const [invNumber, setInvNumber] = useState('');
  const [invDate, setInvDate] = useState(todayISO);
  const [invCurr, setInvCurr] = useState(project.currency);
  const [invAmountHT, setInvAmountHT] = useState('');
  const [invRate, setInvRate] = useState('1');
  const [invFile, setInvFile] = useState<File | null>(null);

  const revisions = useMemo(
    () => snapshot.budgetRevisions.filter((b) => b.projectId === project.id),
    [snapshot.budgetRevisions, project.id]
  );
  const activeBudget = revisions.find((b) => b.status === 'validee');
  const orders = useMemo(
    () => snapshot.purchaseOrders.filter((p) => p.projectId === project.id),
    [snapshot.purchaseOrders, project.id]
  );
  const invoices = useMemo(
    () => snapshot.invoices.filter((i) => i.projectId === project.id),
    [snapshot.invoices, project.id]
  );

  const plannedTotal = activeBudget
    ? activeBudget.lines.reduce((s, l) => s + l.plannedAmount, 0)
    : 0;
  const engagedTotal = orders
    .filter((o) => o.status === 'actif')
    .reduce((s, o) => s + o.amountHT, 0);
  const invoicedTotal = invoices.reduce((s, i) => s + i.convertedAmountHT, 0);
  const pctEngaged = plannedTotal > 0 ? Math.round((engagedTotal / plannedTotal) * 100) : 0;

  if (!canSeeAmounts) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
        <Lock className="w-8 h-8 text-slate-400 mx-auto" />
        <h3 className="text-base font-bold text-slate-900">Confidentialité financière activée</h3>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Les montants budgétaires, bons de commande et factures de ce projet ne sont pas exposés au rôle Responsable. Seuls les statuts de validation sont actifs.
        </p>
      </div>
    );
  }

  const handleSubmitBudget = async (submit: boolean) => {
    setError('');
    try {
      await api.createBudgetRevision(project.id, {
        reason: revReason || 'Proposition budgétaire',
        submit,
        lines: newLines.map((l) => ({
          category: l.category,
          designation: l.designation,
          plannedAmount: Number(l.plannedAmount) || 0,
        })),
      });
      setRevReason('');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur budget');
    }
  };

  const handleCreatePO = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (!poFile) throw new Error('Le scan du bon de commande est obligatoire.');
      const att = await api.uploadAttachment({
        file: poFile,
        entityType: 'order',
        entityId: poNumber,
        projectId: project.id,
      });
      await api.createPurchaseOrder(project.id, {
        budgetLineId: poLineId || activeBudget?.lines[0]?.id || '',
        number: poNumber,
        issueDate: poDate,
        supplierId: poSupplierId,
        amountHT: Number(poAmountHT),
        vatRate: poVat,
        attachmentId: att.id,
      });
      setPoNumber('');
      setPoAmountHT('');
      setPoFile(null);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur bon de commande');
    }
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (!invFile) throw new Error('Le scan de la facture ou de l’avoir est obligatoire.');
      const att = await api.uploadAttachment({
        file: invFile,
        entityType: 'invoice',
        entityId: invNumber,
        projectId: project.id,
      });
      await api.createInvoice(project.id, {
        orderId: invOrderId || orders.find((o) => o.status === 'actif')?.id || '',
        type: invType,
        number: invNumber,
        issueDate: invDate,
        originalCurrency: invCurr,
        originalAmountHT: Number(invAmountHT),
        exchangeRate: Number(invRate) || 1,
        attachmentId: att.id,
      });
      setInvNumber('');
      setInvAmountHT('');
      setInvFile(null);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur facture');
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">{error}</div>
      )}

      {/* Summary Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 flex-1 tabular-nums">
          <div>
            <div className="text-xs text-slate-500">Budget validé HT</div>
            <div className="text-lg font-bold text-slate-900 mt-0.5">
              {formatAmountMAD(plannedTotal, project.currency)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Engagé (Bons actifs)</div>
            <div className="text-lg font-bold text-[#2448C9] mt-0.5">
              {formatAmountMAD(engagedTotal, project.currency)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Facturé net (HT)</div>
            <div className="text-lg font-bold text-slate-900 mt-0.5">
              {formatAmountMAD(invoicedTotal, project.currency)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Taux d’engagement</div>
            <div
              className={`text-lg font-bold mt-0.5 ${
                pctEngaged >= 100
                  ? 'text-red-700'
                  : pctEngaged >= 90
                  ? 'text-amber-700'
                  : 'text-emerald-700'
              }`}
            >
              {pctEngaged}%
            </div>
          </div>
        </div>

        {canManageFinances && (
          <button
            type="button"
            onClick={async () => {
              await api.updateProject(project.id, {
                showAmountsToResponsable: !project.showAmountsToResponsable,
              });
              onRefresh();
            }}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            {project.showAmountsToResponsable ? (
              <>
                <Eye className="w-3.5 h-3.5 text-emerald-700" />
                Montants visibles Responsables
              </>
            ) : (
              <>
                <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                Masqués aux Responsables
              </>
            )}
          </button>
        )}
      </div>

      {/* Budget Revisions */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-slate-900">Lignes &amp; Révisions budgétaires</h3>
        <div className="space-y-3">
          {revisions.map((rev) => {
            const sum = rev.lines.reduce((s, l) => s + l.plannedAmount, 0);
            return (
              <div key={rev.id} className="border border-slate-200 rounded-lg p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-[#2448C9]">V{rev.version}</span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded border bg-slate-50 border-slate-200">
                      {rev.status}
                    </span>
                    <span className="text-sm font-semibold text-slate-900 tabular-nums">
                      {formatAmountMAD(sum, project.currency)}
                    </span>
                  </div>
                  {isDirector && rev.status === 'soumise' && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await api.decideBudgetRevision(project.id, rev.id, 'validee', 'Validé');
                          onRefresh();
                        }}
                        className="px-2.5 py-1 text-xs font-semibold bg-emerald-700 text-white rounded cursor-pointer"
                      >
                        Valider V{rev.version}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await api.decideBudgetRevision(project.id, rev.id, 'a_revoir', 'À ajuster');
                          onRefresh();
                        }}
                        className="px-2.5 py-1 text-xs font-semibold bg-amber-600 text-white rounded cursor-pointer"
                      >
                        À revoir
                      </button>
                    </div>
                  )}
                </div>
                <div className="text-xs text-slate-600">{rev.reason}</div>
                <div className="divide-y divide-slate-100 text-xs pt-1 tabular-nums">
                  {rev.lines.map((l) => (
                    <div key={l.id} className="py-1.5 flex justify-between">
                      <span>
                        <strong className="text-slate-700">{l.category}</strong> — {l.designation}
                      </span>
                      <span className="font-semibold text-slate-900">
                        {formatAmountMAD(l.plannedAmount, project.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {canManageFinances && (
          <div className="border-t border-slate-200 pt-4 space-y-3">
            <div className="text-xs font-bold text-slate-800">Nouvelle révision budgétaire</div>
            <input
              type="text"
              placeholder="Objet de la révision"
              value={revReason}
              onChange={(e) => setRevReason(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
            />
            {newLines.map((line, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="Catégorie"
                  value={line.category}
                  onChange={(e) =>
                    setNewLines((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, category: e.target.value } : x))
                    )
                  }
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                />
                <input
                  type="text"
                  placeholder="Désignation"
                  value={line.designation}
                  onChange={(e) =>
                    setNewLines((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, designation: e.target.value } : x))
                    )
                  }
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                />
                <input
                  type="number"
                  placeholder="Montant HT"
                  value={line.plannedAmount}
                  onChange={(e) =>
                    setNewLines((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, plannedAmount: e.target.value } : x))
                    )
                  }
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                />
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  setNewLines((prev) => [
                    ...prev,
                    { category: 'Prestations', designation: '', plannedAmount: '' },
                  ])
                }
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Ligne
              </button>
              <button
                type="button"
                onClick={() => handleSubmitBudget(true)}
                className="px-3.5 py-1.5 text-xs font-semibold bg-[#2448C9] text-white rounded-lg cursor-pointer"
              >
                Soumettre pour validation Direction
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Purchase Orders & Invoices */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Bons de commande */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <FilePlus2 className="w-4 h-4 text-[#2448C9]" />
            Bons de commande ({orders.length})
          </h3>

          <div className="divide-y divide-slate-100 text-xs tabular-nums">
            {orders.map((po) => (
              <div key={po.id} className="py-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="font-mono font-bold text-[#2448C9] mr-2">{po.number}</span>
                    <span className="font-medium text-slate-900">{po.supplierName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded border font-medium ${
                        po.status === 'actif'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-slate-100 text-slate-500 border-slate-200 line-through'
                      }`}
                    >
                      {po.status === 'actif' ? 'Actif' : 'Annulé'}
                    </span>
                    {canManageFinances && po.status === 'actif' && (
                      <button
                        type="button"
                        onClick={() => {
                          setCancelPoId(po.id);
                          setCancelPoReason('');
                        }}
                        className="text-red-700 hover:underline font-medium cursor-pointer"
                      >
                        Annuler
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-slate-600 flex justify-between">
                  <span>
                    {formatDateFR(po.issueDate)} · TVA {po.vatRate}%
                  </span>
                  <span>
                    <strong>{formatAmountMAD(po.amountHT, po.currency)} HT</strong> (TTC{' '}
                    {formatAmountMAD(po.amountTTC, po.currency)})
                  </span>
                </div>
                {po.cancelReason && (
                  <div className="text-red-700">Motif annulation : {po.cancelReason}</div>
                )}
              </div>
            ))}
          </div>

          {canManageFinances && activeBudget && (
            <form onSubmit={handleCreatePO} className="border-t border-slate-200 pt-3 space-y-2.5">
              <div className="text-xs font-bold text-slate-800">Nouveau bon de commande</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  placeholder="N° BC-2026-..."
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded font-mono"
                />
                <input
                  type="date"
                  value={poDate}
                  onChange={(e) => setPoDate(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={poLineId || activeBudget.lines[0]?.id || ''}
                  onChange={(e) => setPoLineId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                >
                  {activeBudget.lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.designation}
                    </option>
                  ))}
                </select>
                <select
                  value={poSupplierId}
                  onChange={(e) => setPoSupplierId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                >
                  {snapshot.suppliers
                    .filter((s) => s.status !== 'inactif')
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  required
                  min={1}
                  step="0.01"
                  placeholder="Montant HT"
                  value={poAmountHT}
                  onChange={(e) => setPoAmountHT(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                />
                <select
                  value={poVat}
                  onChange={(e) => setPoVat(Number(e.target.value) as 0 | 7 | 10 | 14 | 20)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                >
                  {[20, 14, 10, 7, 0].map((v) => (
                    <option key={v} value={v}>
                      TVA {v}%
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700 border border-dashed border-slate-300 rounded p-2 cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-[#2448C9]" />
                <span>{poFile ? poFile.name : 'Joindre le scan du bon (PDF, PNG, JPG...)'}</span>
                <input
                  type="file"
                  accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.heic"
                  onChange={(e) => setPoFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
              <button
                type="submit"
                className="w-full py-2 text-xs font-semibold bg-[#2448C9] text-white rounded-lg cursor-pointer"
              >
                Émettre le bon de commande
              </button>
            </form>
          )}
        </div>

        {/* Factures & Avoirs */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Receipt className="w-4 h-4 text-[#2448C9]" />
            Factures &amp; Avoirs ({invoices.length})
          </h3>

          <div className="divide-y divide-slate-100 text-xs tabular-nums">
            {invoices.map((inv) => (
              <div key={inv.id} className="py-2.5 flex items-center justify-between gap-2">
                <div>
                  <span className="font-mono font-bold text-slate-800 mr-2">{inv.number}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${
                      inv.type === 'avoir'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-blue-50 text-[#2448C9] border-blue-200'
                    }`}
                  >
                    {inv.type === 'avoir' ? 'Avoir' : 'Facture'}
                  </span>
                  <div className="text-slate-500 mt-0.5">
                    {formatDateFR(inv.issueDate)} · {inv.originalCurrency} (taux {inv.exchangeRate})
                  </div>
                </div>
                <div className="text-right font-semibold text-slate-900">
                  {formatAmountMAD(inv.convertedAmountHT, project.currency)} HT
                </div>
              </div>
            ))}
          </div>

          {canManageFinances && orders.some((o) => o.status === 'actif') && (
            <form onSubmit={handleCreateInvoice} className="border-t border-slate-200 pt-3 space-y-2.5">
              <div className="text-xs font-bold text-slate-800">Enregistrer une facture ou un avoir</div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={invType}
                  onChange={(e) => setInvType(e.target.value as 'facture' | 'avoir')}
                  className="px-2 py-1.5 text-xs border border-slate-300 rounded bg-white"
                >
                  <option value="facture">Facture</option>
                  <option value="avoir">Avoir (-)</option>
                </select>
                <input
                  type="text"
                  required
                  placeholder="N° FAC-2026-..."
                  value={invNumber}
                  onChange={(e) => setInvNumber(e.target.value)}
                  className="col-span-2 px-2.5 py-1.5 text-xs border border-slate-300 rounded font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={invOrderId || orders.find((o) => o.status === 'actif')?.id || ''}
                  onChange={(e) => setInvOrderId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                >
                  {orders
                    .filter((o) => o.status === 'actif')
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.number} ({formatAmountMAD(o.amountHT, o.currency)})
                      </option>
                    ))}
                </select>
                <input
                  type="date"
                  value={invDate}
                  onChange={(e) => setInvDate(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={invCurr}
                  onChange={(e) => setInvCurr(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-slate-300 rounded bg-white"
                >
                  {snapshot.settings.availableCurrencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  required
                  min={0.01}
                  step="0.01"
                  placeholder="Montant HT"
                  value={invAmountHT}
                  onChange={(e) => setInvAmountHT(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                />
                <input
                  type="number"
                  required
                  min={0.01}
                  step="0.0001"
                  placeholder="Taux"
                  value={invRate}
                  onChange={(e) => setInvRate(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                />
              </div>
              {invAmountHT && (
                <div className="text-[11px] bg-blue-50 border border-blue-200 rounded px-2.5 py-1.5 text-[#2448C9] font-medium tabular-nums">
                  Aperçu impact engagé :{' '}
                  {formatAmountMAD(
                    (invType === 'avoir' ? -1 : 1) * (Number(invAmountHT) || 0) * (Number(invRate) || 1),
                    project.currency
                  )}{' '}
                  HT
                </div>
              )}
              <label className="flex items-center gap-2 text-xs text-slate-700 border border-dashed border-slate-300 rounded p-2 cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-[#2448C9]" />
                <span>{invFile ? invFile.name : 'Joindre le justificatif scanné'}</span>
                <input
                  type="file"
                  accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.heic"
                  onChange={(e) => setInvFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
              <button
                type="submit"
                className="w-full py-2 text-xs font-semibold bg-[#2448C9] text-white rounded-lg cursor-pointer"
              >
                Enregistrer la pièce comptable
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Modal Annulation Bon de commande */}
      {cancelPoId && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-600" />
              Annuler le bon de commande
            </h3>
            <textarea
              rows={3}
              placeholder="Motif obligatoire d’annulation..."
              value={cancelPoReason}
              onChange={(e) => setCancelPoReason(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelPoId(null)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg cursor-pointer"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!cancelPoReason.trim()) return;
                  await api.cancelPurchaseOrder(project.id, cancelPoId, cancelPoReason);
                  setCancelPoId(null);
                  onRefresh();
                }}
                className="px-4 py-1.5 text-sm font-semibold bg-red-600 text-white rounded-lg cursor-pointer"
              >
                Confirmer l’annulation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
