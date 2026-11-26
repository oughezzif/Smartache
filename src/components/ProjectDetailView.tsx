import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  History,
  Lock,
  PauseCircle,
  PlayCircle,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { api, type WorkspaceSnapshot } from '../services/api';
import {
  computeProjectTree,
  countWorkedDays,
  formatDateFR,
  resolveScheduleForTask,
} from '../shared/calculationEngine';
import type { PhaseKey, Project } from '../shared/types';
import { ProjectBudgetTab } from './ProjectBudgetTab';
import { ProjectGanttTab } from './ProjectGanttTab';
import {
  PhaseStatusBadge,
  PriorityBadge,
  ProjectStatusBadge,
  TaskStatusBadge,
} from './StatusBadges';

interface ProjectDetailViewProps {
  project: Project;
  snapshot: WorkspaceSnapshot;
  onBack: () => void;
  onRefresh: () => void;
}

type DetailTab = 'phases' | 'gantt' | 'budget' | 'control' | 'history';

export const ProjectDetailView: React.FC<ProjectDetailViewProps> = ({
  project,
  snapshot,
  onBack,
  onRefresh,
}) => {
  const user = snapshot.currentUser;
  const todayISO = snapshot.effectiveTodayISO;
  const [tab, setTab] = useState<DetailTab>('gantt');
  const [error, setError] = useState('');

  // Validation decision form
  const [valComment, setValComment] = useState('');
  const [valReturnPhase, setValReturnPhase] = useState<PhaseKey>(project.phases[0]?.key || 'feasibility');

  // Suspend / Resume modals
  const [showSuspend, setShowSuspend] = useState(false);
  const [suspCat, setSuspCat] = useState('Attente client / fournisseur');
  const [suspComment, setSuspComment] = useState('');
  const [showResume, setShowResume] = useState(false);
  const [shiftTasksOnResume, setShiftTasksOnResume] = useState(true);

  // Control refusal modal
  const [refuseTaskId, setRefuseTaskId] = useState<string | null>(null);
  const [refuseReason, setRefuseReason] = useState('');

  const projectTasks = useMemo(
    () => snapshot.tasks.filter((t) => t.projectId === project.id),
    [snapshot.tasks, project.id]
  );
  const tree = useMemo(
    () =>
      computeProjectTree(
        project,
        projectTasks,
        snapshot.workSchedules,
        snapshot.holidays,
        todayISO
      ),
    [project, projectTasks, snapshot.workSchedules, snapshot.holidays, todayISO]
  );

  const projectAttachments = useMemo(
    () => snapshot.attachments.filter((a) => a.projectId === project.id),
    [snapshot.attachments, project.id]
  );
  const projectHistory = useMemo(
    () => snapshot.businessHistory.filter((h) => h.projectId === project.id),
    [snapshot.businessHistory, project.id]
  );

  const isDirector = user.role === 'directeur';
  const isR0 = project.responsable0Id === user.uid;
  const valPhase = project.phases.find((p) => p.key === 'validation');
  const ctrlPhase = project.phases.find((p) => p.key === 'control');
  const closePhase = project.phases.find((p) => p.key === 'closing');

  const leafTasks = projectTasks.filter((t) => !projectTasks.some((c) => c.parentId === t.id));
  const completedLeaves = leafTasks.filter((t) => t.status === 'terminee');
  const cancelledLeaves = leafTasks.filter((t) => t.status === 'annulee');
  const validatedLeaves = completedLeaves.filter((t) => t.controlStatus === 'validee');

  const pauseWorkedDays = useMemo(() => {
    if (!project.suspension) return 0;
    const sched = resolveScheduleForTask({}, project, snapshot.workSchedules);
    return countWorkedDays(project.suspension.suspendedAt, todayISO, sched, snapshot.holidays);
  }, [project, snapshot.workSchedules, snapshot.holidays, todayISO]);

  const runAction = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur opération');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2448C9] hover:underline mb-1 no-print cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Retour au portefeuille
            </button>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-bold text-[#2448C9]">{project.code}</span>
              <PriorityBadge priority={project.priority} />
              <ProjectStatusBadge status={project.status} inPreparation={!project.planningLaunched} />
              {project.migration?.isMigrated && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200">
                  Reprise de l’existant
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold text-slate-900 font-display">{project.title}</h2>
            <p className="text-sm text-slate-600">{project.description}</p>
          </div>

          <div className="flex flex-col items-end gap-2 tabular-nums">
            <div className="text-right">
              <span className="text-2xl font-bold text-[#2448C9]">{tree.projectProgress}%</span>
              <span className="text-xs text-slate-500 ml-2">Théorique {tree.projectTheoretical}%</span>
            </div>
            <div className="text-xs text-slate-600">
              Responsable 0 : <strong className="text-slate-900">{project.responsable0Name}</strong>
            </div>
            <div className="flex flex-wrap gap-2 no-print">
              {project.status === 'actif' && (isDirector || isR0) && (
                <button
                  type="button"
                  onClick={() => setShowSuspend(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-amber-300 bg-amber-50 text-amber-900 rounded-lg hover:bg-amber-100 cursor-pointer"
                >
                  <PauseCircle className="w-3.5 h-3.5" />
                  Suspendre
                </button>
              )}
              {project.status === 'suspendu' && (isDirector || isR0) && (
                <button
                  type="button"
                  onClick={() => setShowResume(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 cursor-pointer"
                >
                  <PlayCircle className="w-3.5 h-3.5" />
                  Reprendre le projet
                </button>
              )}
            </div>
          </div>
        </div>

        {project.status === 'suspendu' && project.suspension && (
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
            <strong>Projet suspendu depuis le {formatDateFR(project.suspension.suspendedAt)}</strong> ({pauseWorkedDays} j ouvrés écoulés) —{' '}
            {project.suspension.reasonCategory} : {project.suspension.reasonComment}
          </div>
        )}

        {/* Sub-navigation Tabs */}
        <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-3 no-print">
          {[
            { id: 'gantt', label: 'Planning Gantt' },
            { id: 'phases', label: 'Phases & Décisions' },
            { id: 'budget', label: 'Budget & Achats' },
            { id: 'control', label: 'Contrôle & Clôture' },
            { id: 'history', label: 'Historique & Fichiers' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as DetailTab)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                tab === item.id
                  ? 'bg-[#2448C9] text-white border-[#2448C9]'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">{error}</div>
      )}

      {tab === 'gantt' && (
        <ProjectGanttTab project={project} snapshot={snapshot} onRefresh={onRefresh} />
      )}

      {tab === 'budget' && (
        <ProjectBudgetTab project={project} snapshot={snapshot} onRefresh={onRefresh} />
      )}

      {tab === 'phases' && (
        <div className="space-y-5">
          {/* Validation Panel (D5) */}
          {valPhase && valPhase.status === 'en_cours' && isDirector && (
            <div className="bg-white border-2 border-[#2448C9]/30 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#2448C9]" />
                Décision Direction attendue (Validation — règle :{' '}
                {project.multiDirectorRule === 'accord_de_tous' ? 'Accord de tous' : 'Un seul suffit'})
              </h3>
              <textarea
                rows={2}
                placeholder="Commentaire ou motif (obligatoire si À revoir / Rejet)..."
                value={valComment}
                onChange={(e) => setValComment(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <span>En cas de renvoi « À revoir » vers :</span>
                  <select
                    value={valReturnPhase}
                    onChange={(e) => setValReturnPhase(e.target.value as PhaseKey)}
                    className="px-2 py-1 border border-slate-300 rounded bg-white"
                  >
                    {project.phases
                      .filter((p) => p.order < 3)
                      .map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      runAction(() =>
                        api.validationDecision(project.id, { decision: 'valide', comment: valComment })
                      )
                    }
                    className="px-4 py-1.5 text-xs font-semibold bg-emerald-700 text-white rounded-lg cursor-pointer"
                  >
                    Valider le projet
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      runAction(() =>
                        api.validationDecision(project.id, {
                          decision: 'a_revoir',
                          comment: valComment,
                          returnToPhase: valReturnPhase,
                        })
                      )
                    }
                    className="px-4 py-1.5 text-xs font-semibold bg-amber-600 text-white rounded-lg cursor-pointer"
                  >
                    Renvoyer À revoir
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      runAction(() =>
                        api.validationDecision(project.id, { decision: 'rejete', comment: valComment })
                      )
                    }
                    className="px-4 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg cursor-pointer"
                  >
                    Rejeter
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Baseline Requests (D11) */}
          {project.baselineRequests.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">Demandes de nouvelle référence planning</h3>
              <div className="divide-y divide-slate-100 text-xs">
                {project.baselineRequests.map((br) => (
                  <div key={br.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <span className="font-semibold text-slate-900">{br.requestedByName}</span> — {br.reason}
                      <div className="text-slate-500 mt-0.5">
                        Statut : <strong>{br.status}</strong> {br.decisionNote ? `· ${br.decisionNote}` : ''}
                      </div>
                    </div>
                    {isDirector && br.status === 'en_attente' && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            runAction(() => api.decideBaselineRequest(project.id, br.id, 'validee'))
                          }
                          className="px-3 py-1 bg-emerald-700 text-white font-semibold rounded cursor-pointer"
                        >
                          Approuver nouvelle V{project.currentBaselineVersion + 1}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            runAction(() =>
                              api.decideBaselineRequest(project.id, br.id, 'refusee', 'Refusé par la Direction')
                            )
                          }
                          className="px-3 py-1 border border-red-300 text-red-700 font-semibold rounded cursor-pointer"
                        >
                          Refuser
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 7 Phases List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {project.phases.map((ph) => {
              const isLead = ph.stakeholders.some((s) => s.uid === user.uid && s.isLead);
              const canClosePhase =
                project.status === 'actif' &&
                ph.status === 'en_cours' &&
                ph.key !== 'validation' &&
                ph.key !== 'control' &&
                ph.key !== 'closing' &&
                (isLead || isR0 || isDirector);
              return (
                <div key={ph.key} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-sm text-slate-900">
                      {ph.order}. {ph.label}
                    </div>
                    <PhaseStatusBadge status={ph.status} />
                  </div>
                  <div className="text-xs text-slate-500">
                    Transition : <strong>{ph.transitionFromPrev === 'bloquant' ? 'Bloquante' : 'Libre'}</strong>
                    {ph.closedOutOfTool && ' · Close hors outil (Reprise)'}
                  </div>
                  <div className="text-xs text-slate-700">
                    Intervenants :{' '}
                    {ph.stakeholders.map((s) => `${s.displayName}${s.isLead ? ' (Pilote)' : ''}`).join(', ')}
                  </div>
                  {canClosePhase && (
                    <button
                      type="button"
                      onClick={() => runAction(() => api.completePhase(project.id, ph.key))}
                      className="px-3 py-1.5 text-xs font-semibold bg-[#2448C9] text-white rounded-lg cursor-pointer"
                    >
                      Terminer la phase
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'control' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Contrôle R9-R11 */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-[#2448C9]" />
                Phase Contrôle (Responsable 0)
              </h3>
              {ctrlPhase && <PhaseStatusBadge status={ctrlPhase.status} />}
            </div>

            <div className="text-xs text-slate-600 tabular-nums">
              Tâches validées : <strong>{validatedLeaves.length} / {completedLeaves.length}</strong>
              {cancelledLeaves.length > 0 && ` · ${cancelledLeaves.length} tâche(s) annulée(s)`}
            </div>

            {ctrlPhase?.status === 'en_cours' && isR0 && (
              <button
                type="button"
                onClick={() => runAction(() => api.validateAllControl(project.id))}
                className="px-4 py-2 text-xs font-semibold bg-emerald-700 text-white rounded-lg cursor-pointer"
              >
                {completedLeaves.length === 0 ? 'Valider contrôle (0/0)' : 'Tout valider et ouvrir Clôture'}
              </button>
            )}

            <div className="divide-y divide-slate-100 text-xs">
              {completedLeaves.map((t) => (
                <div key={t.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <span className="font-mono font-bold text-[#2448C9] mr-1.5">{t.code}</span>
                    <span className="font-medium text-slate-900">{t.title}</span>
                    <div className="text-slate-500">
                      Contrôle : {t.controlStatus === 'validee' ? 'Validée' : t.controlStatus === 'refusee' ? 'Refusée' : 'En attente'}
                    </div>
                  </div>
                  {ctrlPhase?.status === 'en_cours' && isR0 && t.controlStatus !== 'validee' && (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          runAction(() => api.decideControlTask(project.id, t.id, 'validee'))
                        }
                        className="px-2.5 py-1 bg-emerald-700 text-white font-semibold rounded cursor-pointer"
                      >
                        Valider
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRefuseTaskId(t.id);
                          setRefuseReason('');
                        }}
                        className="px-2.5 py-1 border border-red-300 text-red-700 font-semibold rounded cursor-pointer"
                      >
                        Refuser
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {cancelledLeaves.length > 0 && (
                <div className="pt-3 text-slate-500">
                  <div className="font-semibold mb-1">Tâches annulées (exclues du contrôle) :</div>
                  {cancelledLeaves.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 py-1">
                      <TaskStatusBadge status={t.status} />
                      <span>
                        {t.code} {t.title} ({t.cancelReason})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Clôture D8-D9 */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#2448C9]" />
                Phase Clôture du projet
              </h3>
              {closePhase && <PhaseStatusBadge status={closePhase.status} />}
            </div>

            {closePhase ? (
              <div className="space-y-3">
                <div className="divide-y divide-slate-100 text-xs">
                  {(closePhase.closingSignOffs || []).map((s) => (
                    <div key={s.uid} className="py-2.5 flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-slate-900">{s.displayName}</span>
                        <div className="text-slate-500">
                          {s.signed ? `Signé le ${formatDateFR(s.signedAt?.slice(0, 10))}` : 'En attente de signature'}
                        </div>
                      </div>
                      {s.signed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                      ) : (
                        <span className="text-amber-700 font-medium">Attendu</span>
                      )}
                    </div>
                  ))}
                </div>

                {closePhase.status === 'en_cours' && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => runAction(() => api.closingSignOff(project.id, 'sign'))}
                      className="px-3.5 py-2 text-xs font-semibold bg-[#2448C9] text-white rounded-lg cursor-pointer"
                    >
                      Clôturer ma partie
                    </button>
                    {(isR0 || isDirector) && (
                      <button
                        type="button"
                        onClick={() => runAction(() => api.finalizeClosing(project.id))}
                        className="px-3.5 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg cursor-pointer"
                      >
                        Prononcer la clôture finale (irréversible)
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Ce projet n’inclut pas de phase Clôture formelle.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Pièces jointes */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#2448C9]" />
                Pièces jointes du projet ({projectAttachments.length})
              </h3>
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#2448C9] text-white rounded-lg cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                Ajouter fichier
                <input
                  type="file"
                  accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.heic"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    await runAction(() =>
                      api.uploadAttachment({
                        file: f,
                        entityType: 'project',
                        entityId: project.id,
                        projectId: project.id,
                      })
                    );
                  }}
                  className="hidden"
                />
              </label>
            </div>
            <div className="divide-y divide-slate-100 text-xs">
              {projectAttachments.map((att) => (
                <div key={att.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">
                      {att.fileName} <span className="font-mono text-slate-500">v{att.version}</span>
                    </div>
                    <div className="text-slate-500">
                      {att.uploadedByName} · {(att.sizeBytes / 1024).toFixed(1)} Ko
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => api.downloadAttachment(att)}
                      className="p-1.5 text-[#2448C9] hover:bg-blue-50 rounded cursor-pointer"
                      title="Télécharger"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    {(att.uploadedById === user.uid || isDirector) && (
                      <button
                        type="button"
                        onClick={() => runAction(() => api.removeAttachment(att.id))}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                        title="Retirer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {projectAttachments.length === 0 && (
                <p className="py-6 text-center text-slate-500">Aucune pièce jointe.</p>
              )}
            </div>
          </div>

          {/* Historique métier */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <History className="w-4 h-4 text-[#2448C9]" />
              Historique métier ({projectHistory.length})
            </h3>
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto text-xs">
              {projectHistory.map((h) => (
                <div key={h.id} className="py-2.5">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold text-slate-900">{h.action}</span>
                    <span className="font-mono text-slate-400">{h.timestamp.slice(0, 16).replace('T', ' ')}</span>
                  </div>
                  <div className="text-slate-600">
                    {h.actorName}
                    {h.onBehalfOf && ` (par délégation de ${h.onBehalfOf})`}
                    {h.afterValue && ` · ${h.afterValue}`}
                    {h.reason && ` · Motif : ${h.reason}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modals Suspend / Resume / Control Refuse */}
      {showSuspend && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Suspendre le projet {project.code}</h3>
            <select
              value={suspCat}
              onChange={(e) => setSuspCat(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              <option value="Attente client / fournisseur">Attente client / fournisseur</option>
              <option value="Arbitrage budgétaire">Arbitrage budgétaire</option>
              <option value="Incident technique majeur">Incident technique majeur</option>
            </select>
            <textarea
              rows={3}
              placeholder="Commentaire obligatoire..."
              value={suspComment}
              onChange={(e) => setSuspComment(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSuspend(false)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={async () => {
                  await runAction(() =>
                    api.suspendProject(project.id, {
                      reasonCategory: suspCat,
                      reasonComment: suspComment,
                    })
                  );
                  setShowSuspend(false);
                }}
                className="px-4 py-1.5 text-sm font-semibold bg-amber-600 text-white rounded-lg cursor-pointer"
              >
                Confirmer la suspension
              </button>
            </div>
          </div>
        </div>
      )}

      {showResume && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Reprendre le projet {project.code}</h3>
            <p className="text-sm text-slate-600 tabular-nums">
              Durée de suspension : <strong>{pauseWorkedDays} jour(s) ouvré(s)</strong>.
            </p>
            <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={shiftTasksOnResume}
                onChange={(e) => setShiftTasksOnResume(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Décaler automatiquement les tâches non démarrées (« À faire ») de {pauseWorkedDays} j ouvrés.
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowResume(false)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={async () => {
                  await runAction(() => api.resumeProject(project.id, shiftTasksOnResume));
                  setShowResume(false);
                }}
                className="px-4 py-1.5 text-sm font-semibold bg-emerald-700 text-white rounded-lg cursor-pointer"
              >
                Reprendre le projet
              </button>
            </div>
          </div>
        </div>
      )}

      {refuseTaskId && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-600" />
              Refuser la tâche au contrôle
            </h3>
            <textarea
              rows={3}
              placeholder="Motif du refus (réouvre la tâche à 95 % et envoie AL10)..."
              value={refuseReason}
              onChange={(e) => setRefuseReason(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRefuseTaskId(null)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!refuseReason.trim()) return;
                  await runAction(() =>
                    api.decideControlTask(project.id, refuseTaskId, 'refusee', refuseReason)
                  );
                  setRefuseTaskId(null);
                }}
                className="px-4 py-1.5 text-sm font-semibold bg-red-600 text-white rounded-lg cursor-pointer"
              >
                Refuser et réouvrir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
