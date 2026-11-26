import React, { useState } from 'react';
import { Building, CheckCircle2, Plus, XCircle } from 'lucide-react';
import { api, type WorkspaceSnapshot } from '../services/api';
import { SupplierStatusBadge } from './StatusBadges';

interface SuppliersDirectoryViewProps {
  snapshot: WorkspaceSnapshot;
  onRefresh: () => void;
}

export const SuppliersDirectoryView: React.FC<SuppliersDirectoryViewProps> = ({
  snapshot,
  onRefresh,
}) => {
  const user = snapshot.currentUser;
  const canQualify = user.role === 'responsable_achat' || user.role === 'directeur';
  const [name, setName] = useState('');
  const [ice, setIce] = useState('');
  const [domain, setDomain] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await api.createSupplier({
        name,
        ice,
        domain,
        contactName,
        contactPhone,
        contactEmail,
      });
      setName('');
      setIce('');
      setDomain('');
      setContactName('');
      setContactPhone('');
      setContactEmail('');
      setSuccess(canQualify ? 'Prestataire qualifié ajouté.' : 'Prestataire proposé pour vérification Achats (AL13).');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const handleStatus = async (id: string, status: 'qualifie' | 'inactif') => {
    setError('');
    setSuccess('');
    try {
      await api.updateSupplier(id, { status });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action refusée');
    }
  };

  const pendingSuppliers = snapshot.suppliers.filter((s) => s.status === 'a_verifier');

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 font-display flex items-center gap-2">
            <Building className="w-5 h-5 text-[#2448C9]" />
            Annuaire des prestataires (ICE unique)
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Qualification Achats, validation des propositions Responsables (AL13) et protection des tâches actives.
          </p>
        </div>
        {pendingSuppliers.length > 0 && (
          <div className="px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-xs font-semibold text-amber-900">
            {pendingSuppliers.length} prestataire(s) à vérifier
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">{error}</div>
      )}
      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">{success}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 h-fit">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#2448C9]" />
            {canQualify ? 'Ajouter un prestataire' : 'Proposer un prestataire'}
          </h3>
          <input
            type="text"
            required
            placeholder="Raison sociale"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
          />
          <input
            type="text"
            required
            placeholder="ICE (unique)"
            value={ice}
            onChange={(e) => setIce(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
          />
          <input
            type="text"
            placeholder="Domaine d’intervention"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
          />
          <input
            type="text"
            placeholder="Contact principal"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Téléphone"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <input
              type="email"
              placeholder="E-mail"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2 bg-[#2448C9] hover:bg-[#1d3aa3] text-white text-sm font-semibold rounded-lg cursor-pointer"
          >
            {canQualify ? 'Enregistrer (Qualifié)' : 'Soumettre aux Achats'}
          </button>
        </form>

        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">Prestataire / ICE</th>
                  <th className="px-4 py-2.5">Domaine &amp; Contact</th>
                  <th className="px-4 py-2.5">Statut</th>
                  {canQualify && <th className="px-4 py-2.5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {snapshot.suppliers.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{s.name}</div>
                      <div className="text-xs font-mono text-slate-500">ICE : {s.ice}</div>
                      {s.proposedByName && s.status === 'a_verifier' && (
                        <div className="text-[11px] text-amber-700 mt-0.5">
                          Proposé par {s.proposedByName}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div className="font-medium text-slate-800">{s.domain}</div>
                      <div>{s.contactName} · {s.contactPhone}</div>
                    </td>
                    <td className="px-4 py-3">
                      <SupplierStatusBadge status={s.status} />
                    </td>
                    {canQualify && (
                      <td className="px-4 py-3 text-right space-x-2">
                        {s.status !== 'qualifie' && (
                          <button
                            type="button"
                            onClick={() => handleStatus(s.id, 'qualifie')}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Qualifier
                          </button>
                        )}
                        {s.status !== 'inactif' && (
                          <button
                            type="button"
                            onClick={() => handleStatus(s.id, 'inactif')}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:underline cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Désactiver
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
