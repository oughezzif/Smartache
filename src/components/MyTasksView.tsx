import React, { useMemo, useState } from 'react';
import { CheckSquare, Lock, PauseCircle, Play, Wrench } from 'lucide-react';
import { api, type WorkspaceSnapshot } from '../services/api';
import {
  computeProjectTree,
  formatDateFR,
  resolveScheduleForTask,
  signedVarianceDays,
} from '../shared/calculationEngine';
import { PRIORITY_ORDER, type Intervention, type Project, type ProjectTask } from '../shared/types';
import { ClosingModal } from './ClosingModal';
import { PriorityBadge, TaskStatusBadge, VarianceBadge } from './StatusBadges';

interface MyTasksViewProps {
  snapshot: WorkspaceSnapshot;
  onOpenProject: (projectId: string) => void;
  onRefresh: () => void;
}

export const MyTasksView: React.FC<MyTasksViewProps> = ({
  snapshot,
  onOpenProject,
  onRefresh,
}) => {
  const uid = snapshot.currentUser.uid;
  const todayISO = snapshot.effectiveTodayISO;
  const [filterMode, setFilterMode] = useState<'active' | 'all'>('active');
  const [error, setError] = useState('');
  const [waitTarget, setWaitTarget] = useState<{ kind: 'task' | 'intervention'; projectId?: string; id: string; title: string } | null>(null);
  const [waitReason, setWaitReason] = useState('');
  const [closingTarget, setClosingTarget] = useState<{
    kind: 'task' | 'intervention';
    projectId?: string;
    id: string;
    code: string;
    title: string;
    endDate: string;
    er: number;
  } | null>(null);

  const computedTrees = useMemo(() => {
    const map: Record<string, ReturnType<typeof computeProjectTree>> = {};
    for (const p of snapshot.projects) {
      const pTasks = snapshot.tasks.filter((t) => t.projectId === p.id);
      map[p.id] = computeProjectTree(
        p,
        pTasks,
        snapshot.workSchedules,
        snapshot.holidays,
        todayISO
      );
    }
    return map;
  }, [snapshot, todayISO]);

  const myLeafTasks = useMemo(() => {
    const rows: { task: ProjectTask; project: Project; lockReason: string | null }[] = [];
    for (const p of snapshot.projects) {
      const pTasks = snapshot.tasks.filter((t) => t.projectId === p.id);
      for (const t of pTasks) {
        if (t.assigneeId !== uid && !t.coPilotIds?.includes(uid)) continue;
        const hasChildren = pTasks.some((x) => x.parentId === t.id);
        if (hasChildren) continue;
        if (filterMode === 'active' && (t.status === 'terminee' || t.status === 'annulee')) {
          continue;
        }
        let lockReason: string | null = null;
        if (p.status === 'suspendu') {
          lockReason = 'Projet suspendu';
        } else if (p.status !== 'actif') {
          lockReason = `Projet ${p.status}`;
        } else if (!p.planningLaunched) {
          lockReason = 'Planning non lancé';
        } else {
          for (const dep of t.dependencies) {
            const pred = pTasks.find((x) => x.id === dep.predecessorId);
            if (pred && pred.status !== 'terminee' && pred.status !== 'annulee') {
              lockReason = `Bloqué par ${pred.code} (${pred.title})`;
              break;
            }
          }
        }
        rows.push({ task: t, project: p, lockReason });
      }
    }
    return rows.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.task.priority];
      const pb = PRIORITY_ORDER[b.task.priority];
      if (pa !== pb) return pb - pa;
      if (a.task.endDate !== b.task.endDate) return a.task.endDate.localeCompare(b.task.endDate);
      return a.task.code.localeCompare(b.task.code);
    });
  }, [snapshot, uid, filterMode]);

  const myInterventions = useMemo(() => {
    return snapshot.interventions
      .filter((i) => {
        if (i.assigneeId !== uid) return false;
        if (filterMode === 'active' && (i.status === 'terminee' || i.status === 'annulee')) return false;
        return true;
      })
      .sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority];
        const pb = PRIORITY_ORDER[b.priority];
        if (pa !== pb) return pb - pa;
        return a.endDate.localeCompare(b.endDate);
      });
  }, [snapshot.interventions, uid, filterMode]);

  const runTaskAction = async (
    projectId: string,
    taskId: string,
    payload: Parameters<typeof api.taskAction>[2]
  ) => {
    setError('');
    try {
      await api.taskAction(projectId, taskId, payload);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action refusée');
    }
  };

  const runInterventionAction = async (
    id: string,
    payload: Parameters<typeof api.interventionAction>[1]
  ) => {
    setError('');
    try {
      await api.interventionAction(id, payload);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action refusée');
    }
  };

  const openClosingForTask = (task: ProjectTask, project: Project) => {
    const sched = resolveScheduleForTask(task, project, snapshot.workSchedules);
    const er = signedVarianceDays(todayISO, task.endDate, sched, snapshot.holidays);
    setClosingTarget({
      kind: 'task',
      projectId: project.id,
      id: task.id,
      code: `${project.code} · ${task.code}`,
      title: task.title,
      endDate: task.endDate,
      er,
    });
  };

  const openClosingForIntervention = (intv: Intervention) => {
    const sched =
      snapshot.workSchedules.find((s) => s.id === intv.workScheduleId) ||
      snapshot.workSchedules[0];
    const er = signedVarianceDays(todayISO, intv.endDate, sched, snapshot.holidays);
    setClosingTarget({
      kind: 'intervention',
      id: intv.id,
      code: intv.code,
      title: intv.title,
      endDate: intv.endDate,
      er,
    });
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 font-display flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-[#2448C9]" />
            Mes tâches &amp; interventions (R14)
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Saisie rapide de l’avancement par pas de 5 %, blocages explicites et clôture engageante.
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterMode('active')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
              filterMode === 'active'
                ? 'bg-[#2448C9] text-white border-[#2448C9]'
                : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            À traiter ({myLeafTasks.length + myInterventions.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
              filterMode === 'all'
                ? 'bg-[#2448C9] text-white border-[#2448C9]'
                : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            Tout afficher
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">{error}</div>
      )}

      {/* Tâches projets */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Tâches projets assignées ({myLeafTasks.length})
        </h3>
        {myLeafTasks.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            Aucune tâche projet assignée dans ce filtre.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {myLeafTasks.map(({ task, project, lockReason }) => {
              const metrics = computedTrees[project.id]?.metricsById[task.id];
              const isFinished = task.status === 'terminee' || task.status === 'annulee';
              return (
                <div
                  key={task.id}
                  className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => onOpenProject(project.id)}
                          className="font-mono text-xs font-semibold text-[#2448C9] hover:underline cursor-pointer"
                        >
                          {project.code}
                        </button>
                        <span className="font-mono text-xs font-semibold text-slate-600">
                          Tâche {task.code}
                        </span>
                        <PriorityBadge priority={task.priority} />
                        <TaskStatusBadge status={task.status} />
                        {metrics && <VarianceBadge metrics={metrics} />}
                      </div>
                      <h4 className="text-sm font-bold text-slate-900 mt-1">{task.title}</h4>
                      <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                        {formatDateFR(task.startDate)} → {formatDateFR(task.endDate)}
                        {metrics ? ` · ${metrics.durationWorked} j ouvrés · Th ${metrics.theoreticalProgress}%` : ''}
                        {task.coPilotIds?.includes(uid) && ` · Co-pilote (pilote : ${task.assigneeName})`}
                        {task.assigneeId === uid && task.coPilotNames && task.coPilotNames.length > 0 && ` · Co-pilotes : ${task.coPilotNames.join(', ')}`}
                      </div>
                      {task.waitReason && task.status === 'en_attente' && (
                        <div className="mt-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1">
                          En attente : {task.waitReason}
                        </div>
                      )}
                      {task.controlStatus === 'refusee' && task.controlNote && (
                        <div className="mt-1.5 text-xs text-red-800 bg-red-50 border border-red-200 rounded px-2.5 py-1">
                          Refus contrôle : {task.controlNote}
                        </div>
                      )}
                    </div>
                  </div>

                  {lockReason && !isFinished ? (
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                      <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span>Démarrage verrouillé : {lockReason}</span>
                    </div>
                  ) : !isFinished ? (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
                      <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                        <span className="text-xs font-semibold text-slate-700 w-10 tabular-nums">
                          {task.progress}%
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={95}
                          step={5}
                          value={Math.min(95, task.progress)}
                          onChange={(e) =>
                            runTaskAction(project.id, task.id, {
                              action: 'progress',
                              progress: Number(e.target.value),
                            })
                          }
                          className="flex-1 accent-[#2448C9] cursor-pointer"
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {(task.status === 'a_faire' || task.status === 'en_attente') && (
                          <button
                            type="button"
                            onClick={() => runTaskAction(project.id, task.id, { action: 'start' })}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#2448C9] text-white rounded-lg hover:bg-[#1d3aa3] cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5" />
                            Démarrer
                          </button>
                        )}
                        {task.status === 'en_cours' && (
                          <button
                            type="button"
                            onClick={() => {
                              setWaitReason('');
                              setWaitTarget({ kind: 'task', projectId: project.id, id: task.id, title: task.title });
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-amber-300 text-amber-800 bg-amber-50 rounded-lg hover:bg-amber-100 cursor-pointer"
                          >
                            <PauseCircle className="w-3.5 h-3.5" />
                            En attente
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openClosingForTask(task, project)}
                          className="px-3 py-1.5 text-xs font-semibold bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 cursor-pointer"
                        >
                          Clôturer (100 %)
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Interventions assignées */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5" />
          Interventions assignées ({myInterventions.length})
        </h3>
        {myInterventions.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-sm text-slate-500">
            Aucune intervention assignée.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {myInterventions.map((intv) => {
              const isFinished = intv.status === 'terminee' || intv.status === 'annulee';
              return (
                <div key={intv.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-[#2448C9]">{intv.code}</span>
                    <PriorityBadge priority={intv.priority} />
                    <TaskStatusBadge status={intv.status} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">{intv.title}</h4>
                    <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                      {intv.location || 'Site non précisé'} · {formatDateFR(intv.startDate)} → {formatDateFR(intv.endDate)}
                    </p>
                  </div>
                  {!isFinished && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
                      <div className="flex items-center gap-3 flex-1">
                        <span className="text-xs font-semibold text-slate-700 w-10 tabular-nums">
                          {intv.progress}%
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={95}
                          step={5}
                          value={Math.min(95, intv.progress)}
                          onChange={(e) =>
                            runInterventionAction(intv.id, {
                              action: 'progress',
                              progress: Number(e.target.value),
                            })
                          }
                          className="flex-1 accent-[#2448C9] cursor-pointer"
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {(intv.status === 'a_faire' || intv.status === 'en_attente') && (
                          <button
                            type="button"
                            onClick={() => runInterventionAction(intv.id, { action: 'start' })}
                            className="px-3 py-1.5 text-xs font-semibold bg-[#2448C9] text-white rounded-lg cursor-pointer"
                          >
                            Démarrer
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openClosingForIntervention(intv)}
                          className="px-3 py-1.5 text-xs font-semibold bg-emerald-700 text-white rounded-lg cursor-pointer"
                        >
                          Clôturer (100 %)
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal mise en attente */}
      {waitTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Mise en attente — {waitTarget.title}</h3>
            <textarea
              rows={3}
              placeholder="Motif obligatoire de mise en attente..."
              value={waitReason}
              onChange={(e) => setWaitReason(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setWaitTarget(null)}
                className="px-3 py-1.5 text-sm text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!waitReason.trim()) return;
                  if (waitTarget.kind === 'task' && waitTarget.projectId) {
                    await runTaskAction(waitTarget.projectId, waitTarget.id, {
                      action: 'wait',
                      reason: waitReason,
                    });
                  } else {
                    await runInterventionAction(waitTarget.id, {
                      action: 'wait',
                      reason: waitReason,
                    });
                  }
                  setWaitTarget(null);
                }}
                className="px-3.5 py-1.5 text-sm font-semibold bg-amber-600 text-white rounded-lg cursor-pointer"
              >
                Mettre en attente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal clôture engageante R16 */}
      {closingTarget && (
        <ClosingModal
          code={closingTarget.code}
          title={closingTarget.title}
          plannedEndDate={closingTarget.endDate}
          effectiveTodayISO={todayISO}
          computedEr={closingTarget.er}
          onClose={() => setClosingTarget(null)}
          onConfirm={async (justif) => {
            if (closingTarget.kind === 'task' && closingTarget.projectId) {
              await api.taskAction(closingTarget.projectId, closingTarget.id, {
                action: 'complete',
                delayJustification: justif,
              });
            } else {
              await api.interventionAction(closingTarget.id, {
                action: 'complete',
                delayJustification: justif,
              });
            }
            onRefresh();
          }}
        />
      )}
    </div>
  );
};
