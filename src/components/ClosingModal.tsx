import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { formatDateFR } from '../shared/calculationEngine';

interface ClosingModalProps {
  code: string;
  title: string;
  plannedEndDate: string;
  effectiveTodayISO: string;
  computedEr: number;
  onConfirm: (delayJustification: string) => Promise<void>;
  onClose: () => void;
}

export const ClosingModal: React.FC<ClosingModalProps> = ({
  code,
  title,
  plannedEndDate,
  effectiveTodayISO,
  computedEr,
  onConfirm,
  onClose,
}) => {
  const isDelayed = computedEr < 0;
  const [justification, setJustification] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (isDelayed && justification.trim().length < 20) {
      setError('Une justification d’au moins 20 caractères est obligatoire en cas de retard.');
      return;
    }
    if (!confirmed) {
      setError('Veuillez cocher la confirmation d’achèvement.');
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm(justification.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la clôture');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="font-mono text-xs font-semibold text-[#2448C9]">{code}</span>
            <h3 className="text-base font-bold text-slate-900 mt-0.5">
              Clôture engageante à 100 % (R16)
            </h3>
            <p className="text-sm text-slate-600">{title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-sm tabular-nums">
          <div>
            <div className="text-xs text-slate-500">Fin planifiée (Avant)</div>
            <div className="font-semibold text-slate-900 mt-0.5">{formatDateFR(plannedEndDate)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Clôture réelle (Après)</div>
            <div className="font-semibold text-slate-900 mt-0.5">{formatDateFR(effectiveTodayISO)}</div>
          </div>
          <div className="col-span-2 pt-2 border-t border-slate-200 flex items-center justify-between">
            <span className="text-xs text-slate-600">Écart réel calculé (Er)</span>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded border ${
                computedEr > 0
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : computedEr === 0
                  ? 'bg-blue-50 text-[#2448C9] border-blue-200'
                  : 'bg-red-50 text-red-800 border-red-200'
              }`}
            >
              {computedEr > 0 ? `+${computedEr} j · en avance` : computedEr === 0 ? '0 j · à l’heure' : `${computedEr} j · retard`}
            </span>
          </div>
        </div>

        {isDelayed && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
            <span>
              Cette tâche est clôturée après l’échéance prévue. Une justification détaillée (20 caractères min.) sera enregistrée dans l’historique métier.
            </span>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {isDelayed ? 'Justification du retard (obligatoire, min. 20 caractères)' : 'Commentaire de clôture (optionnel)'}
            </label>
            <textarea
              rows={3}
              required={isDelayed}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Décrivez les livrables achevés ou la cause de l'écart..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            {isDelayed && (
              <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                {justification.trim().length} / 20 caractères minimum
              </div>
            )}
          </div>

          <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-[#2448C9]"
            />
            <span>
              Je confirme que l’ensemble des travaux de cette tâche est achevé à 100 % et prêt pour le contrôle.
            </span>
          </label>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#2448C9] hover:bg-[#1d3aa3] rounded-lg disabled:opacity-60 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              {submitting ? 'Clôture...' : 'Confirmer la clôture (100 %)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
