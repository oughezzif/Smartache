import React, { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FolderKanban,
  PauseCircle,
  Wallet,
  Wrench,
} from 'lucide-react';
import type { WorkspaceSnapshot } from '../services/api';
import {
  addDaysISO,
  computeProjectTree,
  formatAmountMAD,
  formatDateFR,
} from '../shared/calculationEngine';
import { ROLE_LABELS } from '../shared/types';
import { PriorityBadge, ProjectStatusBadge } from './StatusBadges';

interface DashboardViewProps {
  snapshot: WorkspaceSnapshot;
  onOpenProject: (projectId: string) => void;
  onNavigate: (section: 'projects' | 'my_tasks' | 'decisions' | 'suppliers' | 'notifications') => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  snapshot,
  onOpenProject,
  onNavigate,
}) => {
  const user = snapshot.currentUser;
  const todayISO = snapshot.effectiveTodayISO;

  const projectSummaries = useMemo(() => {
    return snapshot.projects.map((p) => {
      const pTasks = snapshot.tasks.filter((t) => t.projectId === p.id);
      const tree = computeProjectTree(
        p,
        pTasks,
        snapshot.workSchedules,
        snapshot.holidays,
        todayISO
      );
      const validBudget = snapshot.budgetRevisions.find(
        (b) => b.projectId === p.id && b.status === 'validee'
      );
      const plannedBudget = validBudget
        ? validBudget.lines.reduce((s, l) => s + l.plannedAmount, 0)
        : 0;
      const engagedHT = snapshot.purchaseOrders
        .filter((po) => po.projectId === p.id && po.status === 'actif')
        .reduce((s, po) => s + po.amountHT, 0);
      const canSeeAmounts = user.role !== 'responsable' || p.showAmountsToResponsable;

      return {
        project: p,
        tree,
        plannedBudget,
        engagedHT,
        canSeeAmounts,
      };
    });
  }, [snapshot, todayISO, user.role]);

  const activeProjects = projectSummaries.filter((s) => s.project.status === 'actif');
  const launchedProjects = activeProjects.filter((s) => s.project.planningLaunched);
  const prepProjects = activeProjects.filter((s) => !s.project.planningLaunched);
  const suspendedProjects = projectSummaries.filter((s) => s.project.status === 'suspendu');

  const globalAvgProgress = launchedProjects.length
    ? Math.round(
        launchedProjects.reduce((acc, s) => acc + s.tree.projectProgress, 0) / launchedProjects.length
      )
    : 0;

  const totalLateTasks = activeProjects.reduce((acc, s) => acc + s.tree.lateLeavesCount, 0);

  // Respect des délais 30 derniers jours
  const thirtyDaysAgo = addDaysISO(todayISO, -30);
  const recentCompleted = snapshot.tasks.filter(
    (t) =>
      t.status === 'terminee' &&
      t.actualEndDate &&
      t.actualEndDate >= thirtyDaysAgo &&
      t.actualEndDate <= todayISO
  );
  const onTimeCount = recentCompleted.filter((t) => (t.frozenEr ?? 0) >= 0).length;
  const respectRate = recentCompleted.length
    ? Math.round((onTimeCount / recentCompleted.length) * 100)
    : 100;

  // Budget aggregate across projects visible to user
  const visibleBudgetSummaries = projectSummaries.filter(
    (s) => s.canSeeAmounts && s.plannedBudget > 0 && s.project.status !== 'annule'
  );
  const totalPlanned = visibleBudgetSummaries.reduce((a, s) => a + s.plannedBudget, 0);
  const totalEngaged = visibleBudgetSummaries.reduce((a, s) => a + s.engagedHT, 0);
  const budgetPct = totalPlanned > 0 ? Math.round((totalEngaged / totalPlanned) * 100) : 0;

  const activeInterventions = snapshot.interventions.filter(
    (i) => i.status !== 'terminee' && i.status !== 'annulee'
  );

  // Decisions pending
  const pendingValidations = snapshot.projects.filter((p) =>
    p.phases.some((ph) => ph.key === 'validation' && ph.status === 'en_cours')
  );
  const pendingBudgets = snapshot.budgetRevisions.filter((b) => b.status === 'soumise');
  const pendingBaselines = snapshot.projects.flatMap((p) =>
    p.baselineRequests.filter((b) => b.status === 'en_attente').map((b) => ({ project: p, req: b }))
  );
  const pendingSuppliers = snapshot.suppliers.filter((s) => s.status === 'a_verifier');

  const exportPortfolioCsv = () => {
    const header = 'Code;Projet;Statut;Responsable 0;Avancement R%;Théorique Th%;Tâches en retard;Budget validé HT;Engagé HT\n';
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = projectSummaries
      .map((s) =>
        [
          s.project.code,
          s.project.title,
          s.project.status,
          s.project.responsable0Name,
          s.tree.projectProgress,
          s.tree.projectTheoretical,
          s.tree.lateLeavesCount,
          s.canSeeAmounts ? s.plannedBudget.toFixed(2) : 'Confidentiel',
          s.canSeeAmounts ? s.engagedHT.toFixed(2) : 'Confidentiel',
        ]
          .map(esc)
          .join(';')
      )
      .join('\n');
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portefeuille-cadence-${todayISO}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">
            Tableau de bord · {ROLE_LABELS[user.role]}
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Vue synthétique au {formatDateFR(todayISO)} ({user.departmentName})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportPortfolioCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#2448C9]" />
            Export CSV Portefeuille
          </button>
        </div>
      </div>

      {/* KPI Row (§12 M7) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 flex items-center justify-between">
            <span>Projets actifs</span>
            <FolderKanban className="w-4 h-4 text-[#2448C9]" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums">
            {activeProjects.length}
          </div>
          <div className="text-xs text-slate-500 mt-1 tabular-nums">
            dont {prepProjects.length} en préparation
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Avancement global</div>
          <div className="text-2xl font-bold text-[#2448C9] mt-1.5 tabular-nums">
            {globalAvgProgress}%
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
            <div
              className="h-full bg-[#2448C9] rounded-full"
              style={{ width: `${globalAvgProgress}%` }}
            />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 flex items-center justify-between">
            <span>Tâches en retard</span>
            <AlertTriangle className={`w-4 h-4 ${totalLateTasks > 0 ? 'text-amber-600' : 'text-slate-400'}`} />
          </div>
          <div className={`text-2xl font-bold mt-1.5 tabular-nums ${totalLateTasks > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
            {totalLateTasks}
          </div>
          <div className="text-xs text-slate-500 mt-1">Feuilles actives en dérive</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 flex items-center justify-between">
            <span>Respect délais (30j)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums">
            {respectRate}%
          </div>
          <div className="text-xs text-slate-500 mt-1 tabular-nums">
            {onTimeCount}/{recentCompleted.length} clôtures à l’heure
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 flex items-center justify-between">
            <span>Budget engagé</span>
            <Wallet className="w-4 h-4 text-slate-500" />
          </div>
          {totalPlanned > 0 ? (
            <>
              <div
                className={`text-2xl font-bold mt-1.5 tabular-nums ${
                  budgetPct >= 100
                    ? 'text-red-700'
                    : budgetPct >= 90
                    ? 'text-amber-700'
                    : 'text-emerald-700'
                }`}
              >
                {budgetPct}%
              </div>
              <div className="text-[11px] text-slate-500 mt-1 tabular-nums truncate">
                {formatAmountMAD(totalEngaged)} / {formatAmountMAD(totalPlanned)}
              </div>
            </>
          ) : (
            <>
              <div className="text-lg font-semibold text-slate-500 mt-1.5">Masqué / N/A</div>
              <div className="text-[11px] text-slate-400 mt-1">Selon confidentialité projet</div>
            </>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500 flex items-center justify-between">
            <span>Interventions</span>
            <Wrench className="w-4 h-4 text-slate-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums">
            {activeInterventions.length}
          </div>
          <div className="text-xs text-slate-500 mt-1">En cours ou à faire</div>
        </div>
      </div>

      {/* Decisions & Suspended quick row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Décisions &amp; arbitrages en attente</h3>
            <span className="font-mono text-xs font-semibold text-[#2448C9]">
              {pendingValidations.length + pendingBudgets.length + pendingBaselines.length + (user.role === 'responsable_achat' ? pendingSuppliers.length : 0)}
            </span>
          </div>
          <div className="space-y-2 text-xs">
            {pendingValidations.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenProject(p.id)}
                className="w-full text-left p-2.5 rounded-lg border border-blue-200 bg-blue-50/50 hover:bg-blue-50 flex items-center justify-between cursor-pointer"
              >
                <div>
                  <span className="font-mono font-semibold text-[#2448C9] mr-1.5">{p.code}</span>
                  <span className="font-medium text-slate-900">Validation Direction</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-[#2448C9]" />
              </button>
            ))}
            {pendingBudgets.map((b) => {
              const p = snapshot.projects.find((x) => x.id === b.projectId);
              if (!p) return null;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onOpenProject(p.id)}
                  className="w-full text-left p-2.5 rounded-lg border border-amber-200 bg-amber-50/50 hover:bg-amber-50 flex items-center justify-between cursor-pointer"
                >
                  <div>
                    <span className="font-mono font-semibold text-amber-800 mr-1.5">{p.code}</span>
                    <span className="font-medium text-slate-900">Budget V{b.version} soumis</span>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-amber-700" />
                </button>
              );
            })}
            {pendingBaselines.map(({ project: p, req }) => (
              <button
                key={req.id}
                type="button"
                onClick={() => onOpenProject(p.id)}
                className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-between cursor-pointer"
              >
                <div>
                  <span className="font-mono font-semibold text-slate-700 mr-1.5">{p.code}</span>
                  <span className="font-medium text-slate-900">Demande de re-baselining</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
              </button>
            ))}
            {user.role === 'responsable_achat' &&
              pendingSuppliers.map((sup) => (
                <button
                  key={sup.id}
                  type="button"
                  onClick={() => onNavigate('suppliers')}
                  className="w-full text-left p-2.5 rounded-lg border border-amber-200 bg-amber-50/50 hover:bg-amber-50 flex items-center justify-between cursor-pointer"
                >
                  <span className="font-medium text-slate-900">
                    Prestataire à vérifier : {sup.name}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-amber-700" />
                </button>
              ))}
            {pendingValidations.length + pendingBudgets.length + pendingBaselines.length === 0 && (
              <p className="text-slate-500 py-4 text-center">Aucune décision bloquante en attente.</p>
            )}
          </div>
        </div>

        {/* Fil des écarts & notifications récentes */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Fil des écarts et alertes actives</h3>
            <button
              type="button"
              onClick={() => onNavigate('notifications')}
              className="text-xs font-semibold text-[#2448C9] hover:underline cursor-pointer"
            >
              Voir tout ({snapshot.notifications.length})
            </button>
          </div>
          <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
            {snapshot.notifications.slice(0, 6).map((n) => (
              <div key={n.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                <div>
                  <span className="font-mono font-semibold px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded mr-2">
                    {n.code}
                  </span>
                  <span className="font-semibold text-slate-900">{n.title}</span>
                  <p className="text-slate-600 mt-0.5">{n.message}</p>
                </div>
                {n.projectId && (
                  <button
                    type="button"
                    onClick={() => onOpenProject(n.projectId!)}
                    className="text-[#2448C9] font-semibold shrink-0 hover:underline cursor-pointer"
                  >
                    Ouvrir
                  </button>
                )}
              </div>
            ))}
            {snapshot.notifications.length === 0 && (
              <p className="text-xs text-slate-500 py-6 text-center">
                Aucun écart critique ni alerte ouverte.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Projets suspendus si présents */}
      {suspendedProjects.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
            <PauseCircle className="w-4 h-4" />
            Projets suspendus ({suspendedProjects.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {suspendedProjects.map(({ project }) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onOpenProject(project.id)}
                className="bg-white border border-amber-200 rounded-lg p-3 text-left hover:border-amber-400 flex items-center justify-between cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-sm text-slate-900">
                    {project.code} — {project.title}
                  </div>
                  <div className="text-xs text-amber-800 mt-0.5">
                    {project.suspension?.reasonCategory} : {project.suspension?.reasonComment}
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-amber-700 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tableau portefeuille */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            Synthèse du portefeuille ({projectSummaries.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5">Projet</th>
                <th className="px-4 py-2.5">Priorité</th>
                <th className="px-4 py-2.5">Statut</th>
                <th className="px-4 py-2.5">Responsable 0</th>
                <th className="px-4 py-2.5">R / Th</th>
                <th className="px-4 py-2.5">Budget HT</th>
                <th className="px-4 py-2.5 text-right">Accès</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {projectSummaries.map(({ project, tree, plannedBudget, engagedHT, canSeeAmounts }) => {
                const pct = plannedBudget > 0 ? Math.round((engagedHT / plannedBudget) * 100) : 0;
                return (
                  <tr key={project.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs font-semibold text-[#2448C9]">
                        {project.code}
                      </div>
                      <div className="font-semibold text-slate-900">{project.title}</div>
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={project.priority} />
                    </td>
                    <td className="px-4 py-3">
                      <ProjectStatusBadge
                        status={project.status}
                        inPreparation={!project.planningLaunched}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">{project.responsable0Name}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">
                        {tree.projectProgress}%{' '}
                        <span className="text-xs font-normal text-slate-500">
                          / Th {tree.projectTheoretical}%
                        </span>
                      </div>
                      {tree.lateLeavesCount > 0 && (
                        <div className="text-[11px] font-medium text-amber-700">
                          {tree.lateLeavesCount} tâche(s) en retard
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {!canSeeAmounts ? (
                        <span className="text-slate-400">Masqué</span>
                      ) : plannedBudget > 0 ? (
                        <div>
                          <div
                            className={`font-semibold ${
                              pct >= 100
                                ? 'text-red-700'
                                : pct >= 90
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                            }`}
                          >
                            {pct}% ({formatAmountMAD(engagedHT, project.currency)})
                          </div>
                          <div className="text-slate-500">
                            sur {formatAmountMAD(plannedBudget, project.currency)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">Non validé</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onOpenProject(project.id)}
                        className="px-3 py-1.5 text-xs font-semibold text-[#2448C9] bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer"
                      >
                        Ouvrir
                      </button>
                    </td>
                  </tr>
                );
              })}
              {projectSummaries.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    Aucun projet enregistré. Créez un projet depuis l’onglet Projets.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
