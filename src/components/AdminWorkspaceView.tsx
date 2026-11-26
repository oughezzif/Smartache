import React, { useState } from 'react';
import {
  Building2,
  CalendarDays,
  Database,
  Download,
  FileSpreadsheet,
  KeyRound,
  Plus,
  Settings,
  Shield,
  Users,
} from 'lucide-react';
import { api, type WorkspaceSnapshot } from '../services/api';
import { formatDateFR } from '../shared/calculationEngine';
import { ROLE_LABELS, type UserRole } from '../shared/types';

interface AdminWorkspaceViewProps {
  snapshot: WorkspaceSnapshot;
  onRefresh: () => void;
}

type AdminTab = 'users' | 'departments' | 'calendar' | 'delegations' | 'settings' | 'audit';

export const AdminWorkspaceView: React.FC<AdminWorkspaceViewProps> = ({ snapshot, onRefresh }) => {
  const [tab, setTab] = useState<AdminTab>('users');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // New user form
  const [uUsername, setUUsername] = useState('');
  const [uDisplayName, setUDisplayName] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uRole, setURole] = useState<UserRole>('responsable');
  const [uDeptId, setUDeptId] = useState(snapshot.departments[0]?.id || '');
  const [uPassword, setUPassword] = useState('');

  // New department
  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');

  // New holiday
  const [holDate, setHolDate] = useState('');
  const [holLabel, setHolLabel] = useState('');
  const [holStatus, setHolStatus] = useState<'confirme' | 'previsionnel'>('confirme');

  // New schedule
  const [schedName, setSchedName] = useState('');
  const [schedDays, setSchedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [schedApplyHol, setSchedApplyHol] = useState(true);
  const [schedHours, setSchedHours] = useState('08:30–17:30');

  // New delegation
  const [delFrom, setDelFrom] = useState('');
  const [delTo, setDelTo] = useState('');
  const [delStart, setDelStart] = useState(snapshot.effectiveTodayISO);
  const [delEnd, setDelEnd] = useState(snapshot.effectiveTodayISO);
  const [delException, setDelException] = useState(false);
  const [delSponsorNote, setDelSponsorNote] = useState('');

  // Settings & §15 Seeder
  const [sysDate, setSysDate] = useState(snapshot.settings.systemDateOverride || '');
  const [al1Pts, setAl1Pts] = useState(snapshot.settings.al1ThresholdPoints);
  const [migEnabled, setMigEnabled] = useState(snapshot.settings.migrationModeEnabled);
  const [seedPass, setSeedPass] = useState('');
  const [seededAccounts, setSeededAccounts] = useState<
    { username: string; displayName: string; role: UserRole; temporaryPassword: string }[]
  >([]);

  const runAction = async (fn: () => Promise<unknown>, successMsg?: string) => {
    setFeedback(null);
    try {
      await fn();
      if (successMsg) setFeedback({ type: 'ok', text: successMsg });
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erreur' });
    }
  };

  const activeUsers = snapshot.users.filter((u) => u.status === 'actif');

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 font-display flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#2448C9]" />
            Administration &amp; Référentiels (M0)
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Gestion des comptes, départements, calendrier, délégations et journal AD9. L’administrateur n’accède pas au contenu des projets.
          </p>
        </div>
        <div className="text-right text-xs text-slate-500 tabular-nums">
          <div>Date système effective : <span className="font-semibold text-slate-900">{formatDateFR(snapshot.effectiveTodayISO)}</span></div>
          <div>Comptes actifs : <span className="font-semibold text-slate-900">{activeUsers.length}</span></div>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-lg border text-sm font-medium ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-3">
        {[
          { id: 'users', label: 'Comptes', icon: Users },
          { id: 'departments', label: 'Départements', icon: Building2 },
          { id: 'calendar', label: 'Calendrier & Programmes', icon: CalendarDays },
          { id: 'delegations', label: 'Délégations', icon: KeyRound },
          { id: 'settings', label: 'Paramètres & Recette §15', icon: Settings },
          { id: 'audit', label: 'Journal AD9', icon: FileSpreadsheet },
        ].map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as AdminTab)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                active
                  ? 'bg-[#2448C9] text-white border-[#2448C9]'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#2448C9]" />
              Créer un compte utilisateur
            </h3>
            <input
              type="text"
              placeholder="Identifiant (ex. nadia.r)"
              value={uUsername}
              onChange={(e) => setUUsername(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <input
              type="text"
              placeholder="Nom complet (ex. Nadia R.)"
              value={uDisplayName}
              onChange={(e) => setUDisplayName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <input
              type="email"
              placeholder="E-mail professionnel"
              value={uEmail}
              onChange={(e) => setUEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <select
              value={uRole}
              onChange={(e) => setURole(e.target.value as UserRole)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              {Object.entries(ROLE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <select
              value={uDeptId}
              onChange={(e) => setUDeptId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              {snapshot.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
            <input
              type="password"
              placeholder="Mot de passe initial (min. 8 car.)"
              value={uPassword}
              onChange={(e) => setUPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <button
              type="button"
              onClick={() =>
                runAction(async () => {
                  await api.createUser({
                    username: uUsername,
                    displayName: uDisplayName,
                    email: uEmail,
                    role: uRole,
                    departmentId: uDeptId,
                    password: uPassword,
                  });
                  setUUsername('');
                  setUDisplayName('');
                  setUEmail('');
                  setUPassword('');
                }, 'Compte créé avec succès.')
              }
              className="w-full py-2 bg-[#2448C9] hover:bg-[#1d3aa3] text-white text-sm font-semibold rounded-lg cursor-pointer"
            >
              Créer le compte
            </button>
          </div>

          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Annuaire des comptes ({snapshot.users.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-2.5">Utilisateur</th>
                    <th className="px-4 py-2.5">Rôle</th>
                    <th className="px-4 py-2.5">Département</th>
                    <th className="px-4 py-2.5">Statut</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {snapshot.users.map((u) => (
                    <tr key={u.uid}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{u.displayName}</div>
                        <div className="text-xs font-mono text-slate-500">{u.username}</div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={u.role}
                          onChange={(e) =>
                            runAction(() => api.updateUser(u.uid, { role: e.target.value as UserRole }), 'Rôle mis à jour.')
                          }
                          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
                        >
                          {Object.entries(ROLE_LABELS).map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">{u.departmentName}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border ${
                            u.status === 'actif'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : u.status === 'en_attente'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {u.status === 'actif' ? 'Actif' : u.status === 'en_attente' ? 'En attente' : 'Désactivé'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {u.status === 'actif' ? (
                          <button
                            type="button"
                            onClick={() =>
                              runAction(() => api.updateUser(u.uid, { status: 'desactive' }), 'Compte désactivé.')
                            }
                            className="text-xs font-medium text-red-700 hover:underline cursor-pointer"
                          >
                            Désactiver
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              runAction(() => api.updateUser(u.uid, { status: 'actif' }), 'Compte réactivé.')
                            }
                            className="text-xs font-medium text-[#2448C9] hover:underline cursor-pointer"
                          >
                            Activer
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'departments' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Nouveau département</h3>
            <input
              type="text"
              placeholder="Nom (ex. Systèmes Industriels)"
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <input
              type="text"
              placeholder="Code court (ex. IND)"
              value={deptCode}
              onChange={(e) => setDeptCode(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg uppercase"
            />
            <button
              type="button"
              onClick={() =>
                runAction(async () => {
                  await api.createDepartment(deptName, deptCode);
                  setDeptName('');
                  setDeptCode('');
                }, 'Département créé.')
              }
              className="w-full py-2 bg-[#2448C9] text-white text-sm font-semibold rounded-lg cursor-pointer"
            >
              Ajouter
            </button>
          </div>
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">Code</th>
                  <th className="px-4 py-2.5">Département</th>
                  <th className="px-4 py-2.5">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {snapshot.departments.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{d.code}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{d.name}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => runAction(() => api.updateDepartment(d.id, { active: !d.active }))}
                        className={`text-xs font-medium px-2 py-0.5 rounded border cursor-pointer ${
                          d.active
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {d.active ? 'Actif' : 'Inactif'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'calendar' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Jours fériés de l’entreprise</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="date"
                value={holDate}
                onChange={(e) => setHolDate(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                placeholder="Libellé (ex. Marche Verte)"
                value={holLabel}
                onChange={(e) => setHolLabel(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <select
                value={holStatus}
                onChange={(e) => setHolStatus(e.target.value as 'confirme' | 'previsionnel')}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="confirme">Confirmé</option>
                <option value="previsionnel">Prévisionnel</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() =>
                runAction(async () => {
                  const res = await api.createHoliday(holDate, holLabel, holStatus);
                  setHolDate('');
                  setHolLabel('');
                  if (res.impactedTasksCount > 0) {
                    setFeedback({
                      type: 'ok',
                      text: `Jour férié ajouté. ${res.impactedTasksCount} tâche(s) en conflit calendrier (AL14 envoyé).`,
                    });
                  }
                })
              }
              className="px-4 py-2 bg-[#2448C9] text-white text-sm font-semibold rounded-lg cursor-pointer"
            >
              Ajouter le jour férié
            </button>

            <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2">
              {snapshot.holidays.map((h) => (
                <div key={h.id} className="py-2.5 flex items-center justify-between gap-2 text-sm">
                  <div>
                    <span className="font-mono text-xs font-semibold text-slate-700 mr-2">
                      {formatDateFR(h.date)}
                    </span>
                    <span className="font-medium text-slate-900">{h.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded border ${
                        h.status === 'confirme'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      {h.status === 'confirme' ? 'Confirmé' : 'Prévisionnel'}
                    </span>
                    <button
                      type="button"
                      onClick={() => runAction(() => api.deleteHoliday(h.id), 'Jour férié supprimé.')}
                      className="text-xs text-red-600 hover:underline cursor-pointer"
                    >
                      Suppr.
                    </button>
                  </div>
                </div>
              ))}
              {snapshot.holidays.length === 0 && (
                <p className="text-xs text-slate-500 py-3">Aucun jour férié enregistré.</p>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Programmes de travail</h3>
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Nom du programme (ex. Équipe Maintenance 6j/7)"
                value={schedName}
                onChange={(e) => setSchedName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <div className="flex flex-wrap gap-1.5">
                {[
                  { d: 1, l: 'Lun' },
                  { d: 2, l: 'Mar' },
                  { d: 3, l: 'Mer' },
                  { d: 4, l: 'Jeu' },
                  { d: 5, l: 'Ven' },
                  { d: 6, l: 'Sam' },
                  { d: 0, l: 'Dim' },
                ].map((day) => {
                  const sel = schedDays.includes(day.d);
                  return (
                    <button
                      key={day.d}
                      type="button"
                      onClick={() =>
                        setSchedDays((prev) =>
                          prev.includes(day.d) ? prev.filter((x) => x !== day.d) : [...prev, day.d]
                        )
                      }
                      className={`px-2.5 py-1 text-xs font-semibold rounded border cursor-pointer ${
                        sel
                          ? 'bg-[#2448C9] text-white border-[#2448C9]'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      {day.l}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={schedApplyHol}
                    onChange={(e) => setSchedApplyHol(e.target.checked)}
                  />
                  Appliquer les jours fériés
                </label>
                <input
                  type="text"
                  value={schedHours}
                  onChange={(e) => setSchedHours(e.target.value)}
                  className="px-2.5 py-1 text-xs border border-slate-300 rounded"
                  placeholder="Horaires"
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  runAction(async () => {
                    await api.createSchedule({
                      name: schedName,
                      workingDays: schedDays,
                      applyHolidays: schedApplyHol,
                      hoursInfo: schedHours,
                    });
                    setSchedName('');
                  }, 'Programme de travail ajouté.')
                }
                className="px-4 py-2 bg-[#2448C9] text-white text-sm font-semibold rounded-lg cursor-pointer"
              >
                Créer le programme
              </button>
            </div>

            <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2">
              {snapshot.workSchedules.map((s) => (
                <div key={s.id} className="py-2.5 text-sm flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-900">{s.name}</div>
                    <div className="text-xs text-slate-500">
                      {s.workingDays.length} j/sem · {s.applyHolidays ? 'Fériés appliqués' : 'Fériés ignorés'}
                      {s.hoursInfo ? ` · ${s.hoursInfo}` : ''}
                    </div>
                  </div>
                  {s.isDefault && (
                    <span className="text-[11px] font-semibold text-[#2448C9]">Par défaut</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'delegations' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Nouvelle délégation</h3>
            <select
              value={delFrom}
              onChange={(e) => setDelFrom(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              <option value="">Délégant...</option>
              {activeUsers.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName} ({ROLE_LABELS[u.role]})
                </option>
              ))}
            </select>
            <select
              value={delTo}
              onChange={(e) => setDelTo(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              <option value="">Délégataire...</option>
              {activeUsers.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName} ({ROLE_LABELS[u.role]})
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={delStart}
                onChange={(e) => setDelStart(e.target.value)}
                className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg"
              />
              <input
                type="date"
                value={delEnd}
                onChange={(e) => setDelEnd(e.target.value)}
                className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={delException}
                onChange={(e) => setDelException(e.target.checked)}
                className="mt-0.5"
              />
              <span>Exception directeur unique (parrainage inter-rôle)</span>
            </label>
            {delException && (
              <input
                type="text"
                placeholder="Motif du parrainage obligatoire"
                value={delSponsorNote}
                onChange={(e) => setDelSponsorNote(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            )}
            <button
              type="button"
              onClick={() =>
                runAction(async () => {
                  await api.createDelegation({
                    delegatorId: delFrom,
                    delegateeId: delTo,
                    startDate: delStart,
                    endDate: delEnd,
                    isSingleDirectorException: delException,
                    sponsorNote: delSponsorNote,
                  });
                }, 'Délégation créée.')
              }
              className="w-full py-2 bg-[#2448C9] text-white text-sm font-semibold rounded-lg cursor-pointer"
            >
              Activer la délégation
            </button>
          </div>

          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">Délégant → Délégataire</th>
                  <th className="px-4 py-2.5">Période</th>
                  <th className="px-4 py-2.5">Statut</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {snapshot.delegations.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">
                        {d.delegatorName} → {d.delegateeName}
                      </div>
                      <div className="text-xs text-slate-500">
                        Rôle délégué : {ROLE_LABELS[d.role]}
                        {d.isSingleDirectorException && ` · Exception : ${d.sponsorNote}`}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {formatDateFR(d.startDate)} → {formatDateFR(d.endDate)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded border ${
                          d.active
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {d.active ? 'Active' : 'Révoquée'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {d.active && (
                        <button
                          type="button"
                          onClick={() => runAction(() => api.revokeDelegation(d.id), 'Délégation révoquée.')}
                          className="text-xs font-medium text-red-700 hover:underline cursor-pointer"
                        >
                          Révoquer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {snapshot.delegations.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-500">
                      Aucune délégation configurée.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Paramètres généraux &amp; Recette</h3>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Date système simulée (vide = date réelle Africa/Casablanca)
              </label>
              <input
                type="date"
                value={sysDate}
                onChange={(e) => setSysDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Seuil alerte AL1 (écart Th − R en points)
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={al1Pts}
                onChange={(e) => setAl1Pts(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={migEnabled}
                onChange={(e) => setMigEnabled(e.target.checked)}
              />
              Activer le mode « Reprise de l’existant » (MIGRATION)
            </label>
            <button
              type="button"
              onClick={() =>
                runAction(
                  () =>
                    api.updateSettings({
                      systemDateOverride: sysDate || undefined,
                      al1ThresholdPoints: al1Pts,
                      migrationModeEnabled: migEnabled,
                    }),
                  'Paramètres enregistrés.'
                )
              }
              className="px-4 py-2 bg-[#2448C9] text-white text-sm font-semibold rounded-lg cursor-pointer"
            >
              Enregistrer les paramètres
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-[#2448C9]" />
              Jeu de données de recette §15 (Cahier des charges)
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Charge les projets RES-2026-01 et VID-2026-05, les interventions INT-2026-014/015/016, les jours fériés 06/11 et 18/11/2026, les bons BC-2026-0412/0413/0450 et les comptes Nadia R., Karima E., M. Alaoui, Mme Bennani, Sara M., Karim B., Youssef A., Leila K. à la date système 21/10/2026.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mot de passe temporaire des comptes de recette (optionnel, 8+ car.)
              </label>
              <input
                type="password"
                placeholder="Laisser vide pour génération aléatoire sécurisée"
                value={seedPass}
                onChange={(e) => setSeedPass(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <button
              type="button"
              onClick={() =>
                runAction(async () => {
                  const res = await api.seedReferenceDataset(seedPass || undefined);
                  setSeededAccounts(res.accounts);
                  setSysDate(res.systemDateOverride);
                }, 'Jeu de recette §15 chargé avec succès.')
              }
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg cursor-pointer"
            >
              Charger le jeu de recette §15
            </button>

            {seededAccounts.length > 0 && (
              <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                <div className="font-bold text-slate-900 mb-2">
                  Comptes créés (mot de passe temporaire affiché une seule fois) :
                </div>
                <div className="space-y-1 font-mono">
                  {seededAccounts.map((acc) => (
                    <div key={acc.username} className="flex justify-between gap-2">
                      <span>
                        {acc.username} ({ROLE_LABELS[acc.role]})
                      </span>
                      <span className="font-semibold text-[#2448C9]">{acc.temporaryPassword}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Journal d’audit AD9 ({snapshot.adminAudit.length})</h3>
            <button
              type="button"
              onClick={() => api.downloadAuditCsv()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#2448C9]" />
              Exporter CSV
            </button>
          </div>
          <div className="overflow-x-auto max-h-[520px]">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 uppercase sticky top-0">
                <tr>
                  <th className="px-4 py-2.5">Horodatage</th>
                  <th className="px-4 py-2.5">Source</th>
                  <th className="px-4 py-2.5">Événement</th>
                  <th className="px-4 py-2.5">Acteur</th>
                  <th className="px-4 py-2.5">Cible / Détails</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {snapshot.adminAudit.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap">
                      {a.timestamp.slice(0, 19).replace('T', ' ')}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-700">{a.source}</td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-800">{a.eventType}</td>
                    <td className="px-4 py-2.5 text-slate-700">{a.actorName}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      <span className="font-medium text-slate-800">{a.targetSummary}</span> — {a.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
