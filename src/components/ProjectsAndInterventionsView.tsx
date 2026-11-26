import React, { useMemo, useState } from 'react';
import { FolderKanban, Plus, Search, Wrench, X } from 'lucide-react';
import { api, type WorkspaceSnapshot } from '../services/api';
import { computeProjectTree, formatDateFR } from '../shared/calculationEngine';
import {
  PHASE_CATALOG,
  type MultiDirectorRule,
  type PhaseKey,
  type Priority,
  type TaskExecutionMode,
  type TransitionMode,
} from '../shared/types';
import { PriorityBadge, ProjectStatusBadge, TaskStatusBadge } from './StatusBadges';

interface ProjectsAndInterventionsViewProps {
  snapshot: WorkspaceSnapshot;
  onOpenProject: (projectId: string) => void;
  onRefresh: () => void;
}

export const ProjectsAndInterventionsView: React.FC<ProjectsAndInterventionsViewProps> = ({
  snapshot,
  onOpenProject,
  onRefresh,
}) => {
  const user = snapshot.currentUser;
  const todayISO = snapshot.effectiveTodayISO;
  const [subTab, setSubTab] = useState<'projects' | 'interventions'>('projects');
  const [search, setSearch] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [showNewIntervention, setShowNewIntervention] = useState(false);
  const [error, setError] = useState('');

  // Project creation wizard state
  const nonDirectors = snapshot.directory.filter(
    (u) => u.status === 'actif' && u.role !== 'directeur' && u.role !== 'administrateur'
  );
  const directors = snapshot.directory.filter((u) => u.status === 'actif' && u.role === 'directeur');
  const purchasingUsers = snapshot.directory.filter(
    (u) => u.status === 'actif' && u.role === 'responsable_achat'
  );

  const activeOperationalUsers = snapshot.directory.filter(
    (u) => u.status === 'actif' && u.role !== 'administrateur'
  );

  const [pTitle, setPTitle] = useState('');
  const [pCode, setPCode] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [pPriority, setPPriority] = useState<Priority>('haute');
  const [pR0, setPR0] = useState(nonDirectors[0]?.uid || '');
  const [pSched, setPSched] = useState(snapshot.workSchedules[0]?.id || 'sched_ouvres');
  const [pShowAmounts, setPShowAmounts] = useState(true);
  const [pRule, setPRule] = useState<MultiDirectorRule>('accord_de_tous');
  const [pStart, setPStart] = useState(todayISO);
  const [pEnd, setPEnd] = useState(todayISO);
  const [pMigration, setPMigration] = useState(false);
  const [pMigBudgetAmount, setPMigBudgetAmount] = useState('');

  type PhaseConfigState = {
    enabled: boolean;
    transition: TransitionMode;
    stakeholders: { uid: string; isLead: boolean }[];
    closedOutOfTool: boolean;
  };

  const makeInitialPhases = (r0Uid: string): Record<PhaseKey, PhaseConfigState> => {
    const defaultR0 = r0Uid || nonDirectors[0]?.uid || '';
    const defaultPur = purchasingUsers[0]?.uid || defaultR0;
    const defaultDirs = directors.map((d, idx) => ({ uid: d.uid, isLead: idx === 0 }));
    return {
      feasibility: {
        enabled: true,
        transition: 'libre',
        stakeholders: defaultR0 ? [{ uid: defaultR0, isLead: true }] : [],
        closedOutOfTool: false,
      },
      budget_study: {
        enabled: true,
        transition: 'bloquant',
        stakeholders: defaultPur ? [{ uid: defaultPur, isLead: true }] : [],
        closedOutOfTool: false,
      },
      validation: {
        enabled: true,
        transition: 'bloquant',
        stakeholders: defaultDirs,
        closedOutOfTool: false,
      },
      orders: {
        enabled: true,
        transition: 'libre',
        stakeholders: defaultPur ? [{ uid: defaultPur, isLead: true }] : [],
        closedOutOfTool: false,
      },
      planning: {
        enabled: true,
        transition: 'libre',
        stakeholders: defaultR0 ? [{ uid: defaultR0, isLead: true }] : [],
        closedOutOfTool: false,
      },
      control: {
        enabled: true,
        transition: 'bloquant',
        stakeholders: defaultR0 ? [{ uid: defaultR0, isLead: true }] : [],
        closedOutOfTool: false,
      },
      closing: {
        enabled: true,
        transition: 'bloquant',
        stakeholders: defaultR0 ? [{ uid: defaultR0, isLead: true }] : [],
        closedOutOfTool: false,
      },
    };
  };

  const [selectedPhases, setSelectedPhases] = useState<Record<PhaseKey, PhaseConfigState>>(() =>
    makeInitialPhases(nonDirectors[0]?.uid || '')
  );

  type InitialTaskDraft = {
    id: string;
    title: string;
    priority: Priority;
    startDate: string;
    endDate: string;
    assigneeId: string;
    coPilotIds: string[];
    executionMode: TaskExecutionMode;
  };
  const [initialTasks, setInitialTasks] = useState<InitialTaskDraft[]>([]);

  // Intervention creation state
  const [iTitle, setITitle] = useState('');
  const [iDesc, setIDesc] = useState('');
  const [iPriority, setIPriority] = useState<Priority>('haute');
  const [iLoc, setILoc] = useState('');
  const [iReq, setIReq] = useState(user.displayName);
  const [iStart, setIStart] = useState(todayISO);
  const [iEnd, setIEnd] = useState(todayISO);
  const [iAssignee, setIAssignee] = useState(nonDirectors[0]?.uid || user.uid);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshot.projects.filter(
      (p) =>
        !q ||
        p.code.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q) ||
        p.responsable0Name.toLowerCase().includes(q)
    );
  }, [snapshot.projects, search]);

  const filteredInterventions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshot.interventions.filter(
      (i) =>
        !q ||
        i.code.toLowerCase().includes(q) ||
        i.title.toLowerCase().includes(q) ||
        i.createdByName.toLowerCase().includes(q)
    );
  }, [snapshot.interventions, search]);

  const togglePhase = (key: PhaseKey) => {
    if (key === 'planning') return; // always active
    setSelectedPhases((prev) => {
      const next = { ...prev, [key]: { ...prev[key], enabled: !prev[key].enabled } };
      // Composition rules §3.1: closing -> control -> planning
      if (key === 'closing' && next.closing.enabled) {
        next.control = { ...next.control, enabled: true };
      }
      if (key === 'control' && !next.control.enabled) {
        next.closing = { ...next.closing, enabled: false };
      }
      return next;
    });
  };

  const addPhaseStakeholder = (key: PhaseKey, uid: string) => {
    if (!uid) return;
    setSelectedPhases((prev) => {
      const current = prev[key].stakeholders;
      if (current.some((s) => s.uid === uid)) return prev;
      const nextList = [...current, { uid, isLead: current.length === 0 }];
      return { ...prev, [key]: { ...prev[key], stakeholders: nextList } };
    });
  };

  const removePhaseStakeholder = (key: PhaseKey, uid: string) => {
    setSelectedPhases((prev) => {
      if (key === 'control' && uid === pR0) return prev;
      const current = prev[key].stakeholders;
      if (current.length <= 1) return prev;
      const filtered = current.filter((s) => s.uid !== uid);
      if (!filtered.some((s) => s.isLead) && filtered.length > 0) {
        filtered[0] = { ...filtered[0], isLead: true };
      }
      return { ...prev, [key]: { ...prev[key], stakeholders: filtered } };
    });
  };

  const togglePhaseStakeholderLead = (key: PhaseKey, uid: string) => {
    if (key === 'control') return;
    setSelectedPhases((prev) => {
      const current = prev[key].stakeholders;
      const leadCount = current.filter((s) => s.isLead).length;
      const target = current.find((s) => s.uid === uid);
      if (target?.isLead && leadCount <= 1) return prev;
      const nextList = current.map((s) => (s.uid === uid ? { ...s, isLead: !s.isLead } : s));
      return { ...prev, [key]: { ...prev[key], stakeholders: nextList } };
    });
  };

  const handleR0Change = (nextR0: string) => {
    setPR0(nextR0);
    setSelectedPhases((prev) => {
      const ctrlExtra = prev.control.stakeholders.filter((s) => s.uid !== pR0 && s.uid !== nextR0);
      return {
        ...prev,
        control: {
          ...prev.control,
          stakeholders: nextR0 ? [{ uid: nextR0, isLead: true }, ...ctrlExtra] : ctrlExtra,
        },
      };
    });
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const phasesPayload = PHASE_CATALOG.filter((c) => selectedPhases[c.key].enabled).map((c) => {
        const cfg = selectedPhases[c.key];
        let stakeholders = cfg.stakeholders;
        if (c.key === 'control') {
          const extras = stakeholders.filter((s) => s.uid !== pR0);
          stakeholders = [{ uid: pR0, isLead: true }, ...extras];
        } else if (stakeholders.length === 0) {
          stakeholders =
            c.key === 'validation'
              ? directors.slice(0, 1).map((d) => ({ uid: d.uid, isLead: true }))
              : [{ uid: pR0, isLead: true }];
        }
        return {
          key: c.key,
          transitionFromPrev: c.key === 'control' || c.key === 'closing' ? 'bloquant' : cfg.transition,
          stakeholders,
          closedOutOfTool: pMigration ? cfg.closedOutOfTool : false,
        };
      });

      const migLines =
        pMigration && Number(pMigBudgetAmount) > 0
          ? [{ category: 'Reprise existant', designation: 'Enveloppe validée reprise', plannedAmount: Number(pMigBudgetAmount) }]
          : undefined;

      const initialTasksPayload = initialTasks
        .filter((t) => t.title.trim())
        .map((t) => ({
          title: t.title.trim(),
          priority: t.priority,
          startDate: t.startDate,
          endDate: t.endDate >= t.startDate ? t.endDate : t.startDate,
          assigneeId: t.assigneeId || pR0,
          coPilotIds: t.coPilotIds.filter((id) => id && id !== (t.assigneeId || pR0)),
          executionMode: t.executionMode,
        }));

      const res = await api.createProject({
        code: pCode || undefined,
        title: pTitle,
        description: pDesc,
        priority: pPriority,
        responsable0Id: pR0,
        workScheduleId: pSched,
        currency: snapshot.settings.defaultCurrency,
        showAmountsToResponsable: pShowAmounts,
        multiDirectorRule: pRule,
        targetStartDate: pStart,
        targetEndDate: pEnd,
        isMigration: pMigration,
        migrationBudgetLines: migLines,
        phases: phasesPayload,
        initialTasks: initialTasksPayload.length > 0 ? initialTasksPayload : undefined,
      });

      setShowNewProject(false);
      setPTitle('');
      setPCode('');
      setPDesc('');
      setInitialTasks([]);
      setSelectedPhases(makeInitialPhases(pR0));
      onRefresh();
      onOpenProject(res.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur création projet');
    }
  };

  const handleCreateIntervention = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.createIntervention({
        title: iTitle,
        description: iDesc,
        priority: iPriority,
        location: iLoc,
        requesterName: iReq,
        startDate: iStart,
        endDate: iEnd,
        assigneeId: iAssignee,
        executionMode: 'interne',
      });
      setShowNewIntervention(false);
      setITitle('');
      setIDesc('');
      setILoc('');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur création intervention');
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('projects')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border cursor-pointer ${
              subTab === 'projects'
                ? 'bg-[#2448C9] text-white border-[#2448C9]'
                : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            <FolderKanban className="w-4 h-4" />
            Projets ({snapshot.projects.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('interventions')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border cursor-pointer ${
              subTab === 'interventions'
                ? 'bg-[#2448C9] text-white border-[#2448C9]'
                : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            <Wrench className="w-4 h-4" />
            Interventions ({snapshot.interventions.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Rechercher code, titre..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          {subTab === 'projects' ? (
            <button
              type="button"
              onClick={() => {
                setError('');
                setShowNewProject(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#2448C9] hover:bg-[#1d3aa3] text-white rounded-lg cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Nouveau projet
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setError('');
                setShowNewIntervention(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#2448C9] hover:bg-[#1d3aa3] text-white rounded-lg cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Nouvelle intervention
            </button>
          )}
        </div>
      </div>

      {subTab === 'projects' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredProjects.map((p) => {
            const pTasks = snapshot.tasks.filter((t) => t.projectId === p.id);
            const tree = computeProjectTree(
              p,
              pTasks,
              snapshot.workSchedules,
              snapshot.holidays,
              todayISO
            );
            const activePhases = p.phases.filter((ph) => ph.status === 'en_cours').map((ph) => ph.label);
            return (
              <div
                key={p.id}
                onClick={() => onOpenProject(p.id)}
                className="bg-white border border-slate-200 hover:border-[#2448C9] rounded-xl p-5 space-y-3 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-[#2448C9]">{p.code}</span>
                      <PriorityBadge priority={p.priority} />
                      <ProjectStatusBadge status={p.status} inPreparation={!p.planningLaunched} />
                      {p.migration?.isMigrated && (
                        <span className="text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                          Reprise
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mt-1">{p.title}</h3>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="text-lg font-bold text-[#2448C9]">{tree.projectProgress}%</div>
                    <div className="text-[11px] text-slate-500">Th {tree.projectTheoretical}%</div>
                  </div>
                </div>
                <p className="text-xs text-slate-600 line-clamp-2">{p.description}</p>
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#2448C9] rounded-full"
                    style={{ width: `${tree.projectProgress}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 pt-1">
                  <span>R0 : <strong className="text-slate-700">{p.responsable0Name}</strong></span>
                  <span>
                    Phases actives :{' '}
                    <strong className="text-slate-700">
                      {activePhases.length > 0 ? activePhases.join(', ') : 'Aucune'}
                    </strong>
                  </span>
                </div>
              </div>
            );
          })}
          {filteredProjects.length === 0 && (
            <div className="col-span-full bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
              Aucun projet correspondant.
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">Code / Titre</th>
                  <th className="px-4 py-2.5">Priorité</th>
                  <th className="px-4 py-2.5">Lancée par / Département</th>
                  <th className="px-4 py-2.5">Assigné à</th>
                  <th className="px-4 py-2.5">Échéance</th>
                  <th className="px-4 py-2.5">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {filteredInterventions.map((i) => (
                  <tr key={i.id}>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs font-semibold text-[#2448C9]">{i.code}</div>
                      <div className="font-semibold text-slate-900">{i.title}</div>
                      {i.location && <div className="text-xs text-slate-500">{i.location}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={i.priority} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <div className="font-medium text-slate-900">{i.createdByName}</div>
                      <div className="text-slate-500">{i.departmentName}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">{i.assigneeName}</td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-600">
                      {formatDateFR(i.startDate)} → {formatDateFR(i.endDate)}
                    </td>
                    <td className="px-4 py-3">
                      <TaskStatusBadge status={i.status} />
                      <span className="ml-2 text-xs font-semibold text-slate-700">{i.progress}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Nouveau Projet (Phases à la carte + MIGRATION) */}
      {showNewProject && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-4xl w-full p-6 my-6 max-h-[92vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 font-display">
                Création de projet — Phases à la carte (M1)
              </h3>
              <button
                type="button"
                onClick={() => setShowNewProject(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">{error}</div>
            )}

            <form onSubmit={handleCreateProject} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  placeholder="Code (auto si vide)"
                  value={pCode}
                  onChange={(e) => setPCode(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono uppercase"
                />
                <input
                  type="text"
                  required
                  placeholder="Titre du projet"
                  value={pTitle}
                  onChange={(e) => setPTitle(e.target.value)}
                  className="sm:col-span-2 px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <textarea
                rows={2}
                placeholder="Description & objectifs..."
                value={pDesc}
                onChange={(e) => setPDesc(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Priorité</label>
                  <select
                    value={pPriority}
                    onChange={(e) => setPPriority(e.target.value as Priority)}
                    className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="critique">Critique</option>
                    <option value="haute">Haute</option>
                    <option value="moyenne">Moyenne</option>
                    <option value="basse">Basse</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Responsable 0 (hors Directeur)
                  </label>
                  <select
                    required
                    value={pR0}
                    onChange={(e) => handleR0Change(e.target.value)}
                    className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {nonDirectors.map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Programme</label>
                  <select
                    value={pSched}
                    onChange={(e) => setPSched(e.target.value)}
                    className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {snapshot.workSchedules.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Règle multi-Directeur</label>
                  <select
                    value={pRule}
                    onChange={(e) => setPRule(e.target.value as MultiDirectorRule)}
                    className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="accord_de_tous">Accord de tous</option>
                    <option value="un_seul_suffit">Un seul suffit</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Début cible</label>
                  <input
                    type="date"
                    value={pStart}
                    onChange={(e) => setPStart(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Fin cible</label>
                  <input
                    type="date"
                    value={pEnd}
                    onChange={(e) => setPEnd(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* 7 Phases à la carte — Multi-pilotes sur chaque étape */}
              <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold text-slate-800">
                    Composition des phases (1 ou plusieurs pilotes par étape)
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Planification toujours active · Contrôle piloté par R0 (+ co-pilotes optionnels)
                  </div>
                </div>
                <div className="divide-y divide-slate-100">
                  {PHASE_CATALOG.map((cat) => {
                    const cfg = selectedPhases[cat.key];
                    const isLockedTransition = cat.key === 'control' || cat.key === 'closing';
                    const selectedIds = new Set(cfg.stakeholders.map((s) => s.uid));
                    const eligiblePool =
                      cat.key === 'validation'
                        ? directors.filter((u) => !selectedIds.has(u.uid))
                        : cat.key === 'control'
                        ? nonDirectors.filter((u) => !selectedIds.has(u.uid))
                        : activeOperationalUsers.filter(
                            (u) => !selectedIds.has(u.uid) && cat.eligibleRoles.includes(u.role)
                          );
                    const otherPool =
                      cat.key === 'validation' || cat.key === 'control'
                        ? []
                        : activeOperationalUsers.filter(
                            (u) => !selectedIds.has(u.uid) && !cat.eligibleRoles.includes(u.role)
                          );

                    return (
                      <div key={cat.key} className="py-2.5 space-y-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center gap-2 font-semibold text-slate-900 min-w-[190px]">
                            <input
                              type="checkbox"
                              checked={cfg.enabled}
                              disabled={cat.key === 'planning'}
                              onChange={() => togglePhase(cat.key)}
                            />
                            <span>
                              {cat.order}. {cat.label}
                            </span>
                          </label>
                          {cfg.enabled && (
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                disabled={isLockedTransition}
                                value={isLockedTransition ? 'bloquant' : cfg.transition}
                                onChange={(e) =>
                                  setSelectedPhases((prev) => ({
                                    ...prev,
                                    [cat.key]: {
                                      ...prev[cat.key],
                                      transition: e.target.value as TransitionMode,
                                    },
                                  }))
                                }
                                className="px-2 py-1 border border-slate-200 rounded bg-white"
                              >
                                <option value="libre">Transition Libre</option>
                                <option value="bloquant">Transition Bloquante</option>
                              </select>
                              {pMigration && cat.key !== 'planning' && cat.key !== 'control' && cat.key !== 'closing' && (
                                <label className="flex items-center gap-1 text-indigo-700">
                                  <input
                                    type="checkbox"
                                    checked={cfg.closedOutOfTool}
                                    onChange={(e) =>
                                      setSelectedPhases((prev) => ({
                                        ...prev,
                                        [cat.key]: { ...prev[cat.key], closedOutOfTool: e.target.checked },
                                      }))
                                    }
                                  />
                                  Close hors outil
                                </label>
                              )}
                            </div>
                          )}
                        </div>

                        {cfg.enabled && (
                          <div className="pl-5 flex flex-wrap items-center gap-1.5">
                            {cfg.stakeholders.map((s) => {
                              const u = snapshot.directory.find((d) => d.uid === s.uid);
                              const isLockedR0 = cat.key === 'control' && s.uid === pR0;
                              const canRemove = !isLockedR0 && cfg.stakeholders.length > 1;
                              return (
                                <span
                                  key={s.uid}
                                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] ${
                                    s.isLead
                                      ? 'bg-blue-50 border-blue-200 text-[#1d3aa3] font-semibold'
                                      : 'bg-slate-50 border-slate-200 text-slate-700'
                                  }`}
                                >
                                  <span>{u?.displayName || s.uid}</span>
                                  <button
                                    type="button"
                                    disabled={cat.key === 'control'}
                                    onClick={() => togglePhaseStakeholderLead(cat.key, s.uid)}
                                    title={
                                      cat.key === 'control'
                                        ? 'R0 pilote principal du contrôle'
                                        : 'Basculer Pilote / Co-pilote'
                                    }
                                    className="text-[10px] underline decoration-dotted cursor-pointer disabled:no-underline disabled:cursor-default"
                                  >
                                    {s.isLead ? 'Pilote' : 'Co-pilote'}
                                  </button>
                                  {canRemove && (
                                    <button
                                      type="button"
                                      onClick={() => removePhaseStakeholder(cat.key, s.uid)}
                                      className="text-slate-400 hover:text-red-600 cursor-pointer"
                                      title="Retirer de cette phase"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  )}
                                </span>
                              );
                            })}

                            {(eligiblePool.length > 0 || otherPool.length > 0) && (
                              <select
                                value=""
                                onChange={(e) => addPhaseStakeholder(cat.key, e.target.value)}
                                className="px-2 py-1 border border-dashed border-slate-300 rounded bg-white text-[11px] text-slate-700 cursor-pointer"
                              >
                                <option value="">+ Ajouter un pilote...</option>
                                {eligiblePool.map((u) => (
                                  <option key={u.uid} value={u.uid}>
                                    {u.displayName} ({u.role === 'directeur' ? 'Directeur' : u.role === 'responsable_achat' ? 'Achats' : 'Responsable'})
                                  </option>
                                ))}
                                {otherPool.length > 0 && (
                                  <optgroup label="Autres collaborateurs">
                                    {otherPool.map((u) => (
                                      <option key={u.uid} value={u.uid}>
                                        {u.displayName} ({u.role === 'directeur' ? 'Directeur' : u.role === 'responsable_achat' ? 'Achats' : 'Responsable'})
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                              </select>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Tâches initiales du planning avec 1 ou plusieurs pilotes */}
              <div className="border border-slate-200 rounded-lg p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-slate-800">
                      Tâches initiales du planning (1 ou plusieurs pilotes par tâche)
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Optionnel — créez dès maintenant les premières tâches et affectez leur pilote principal et co-pilotes.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setInitialTasks((prev) => [
                        ...prev,
                        {
                          id: `draft_${Date.now()}_${prev.length}`,
                          title: '',
                          priority: pPriority,
                          startDate: pStart,
                          endDate: pEnd >= pStart ? pEnd : pStart,
                          assigneeId: pR0 || activeOperationalUsers[0]?.uid || '',
                          coPilotIds: [],
                          executionMode: 'interne',
                        },
                      ])
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold border border-[#2448C9] text-[#2448C9] rounded-md hover:bg-blue-50 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Ajouter une tâche
                  </button>
                </div>

                {initialTasks.length > 0 && (
                  <div className="space-y-2">
                    {initialTasks.map((draft, idx) => {
                      const availCoPilots = activeOperationalUsers.filter(
                        (u) => u.uid !== draft.assigneeId && !draft.coPilotIds.includes(u.uid)
                      );
                      return (
                        <div key={draft.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs">
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                            <input
                              type="text"
                              placeholder={`Tâche ${idx + 1} — Titre`}
                              value={draft.title}
                              onChange={(e) =>
                                setInitialTasks((prev) =>
                                  prev.map((x) => (x.id === draft.id ? { ...x, title: e.target.value } : x))
                                )
                              }
                              className="sm:col-span-4 px-2.5 py-1.5 border border-slate-300 rounded bg-white"
                            />
                            <input
                              type="date"
                              value={draft.startDate}
                              onChange={(e) =>
                                setInitialTasks((prev) =>
                                  prev.map((x) => (x.id === draft.id ? { ...x, startDate: e.target.value } : x))
                                )
                              }
                              className="sm:col-span-2 px-2 py-1.5 border border-slate-300 rounded bg-white"
                            />
                            <input
                              type="date"
                              value={draft.endDate}
                              onChange={(e) =>
                                setInitialTasks((prev) =>
                                  prev.map((x) => (x.id === draft.id ? { ...x, endDate: e.target.value } : x))
                                )
                              }
                              className="sm:col-span-2 px-2 py-1.5 border border-slate-300 rounded bg-white"
                            />
                            <select
                              value={draft.assigneeId}
                              onChange={(e) => {
                                const nextAssignee = e.target.value;
                                setInitialTasks((prev) =>
                                  prev.map((x) =>
                                    x.id === draft.id
                                      ? {
                                          ...x,
                                          assigneeId: nextAssignee,
                                          coPilotIds: x.coPilotIds.filter((c) => c !== nextAssignee),
                                        }
                                      : x
                                  )
                                );
                              }}
                              className="sm:col-span-3 px-2 py-1.5 border border-slate-300 rounded bg-white"
                              title="Pilote principal"
                            >
                              {activeOperationalUsers.map((u) => (
                                <option key={u.uid} value={u.uid}>
                                  Pilote : {u.displayName}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() =>
                                setInitialTasks((prev) => prev.filter((x) => x.id !== draft.id))
                              }
                              className="sm:col-span-1 justify-self-end p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                              title="Supprimer cette tâche"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-medium text-slate-600">Co-pilotes :</span>
                            {draft.coPilotIds.map((cpId) => {
                              const u = snapshot.directory.find((d) => d.uid === cpId);
                              return (
                                <span
                                  key={cpId}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-slate-200 text-[11px] text-slate-700"
                                >
                                  <span>{u?.displayName || cpId}</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setInitialTasks((prev) =>
                                        prev.map((x) =>
                                          x.id === draft.id
                                            ? { ...x, coPilotIds: x.coPilotIds.filter((c) => c !== cpId) }
                                            : x
                                        )
                                      )
                                    }
                                    className="text-slate-400 hover:text-red-600 cursor-pointer"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              );
                            })}
                            {availCoPilots.length > 0 && (
                              <select
                                value=""
                                onChange={(e) => {
                                  const cpId = e.target.value;
                                  if (!cpId) return;
                                  setInitialTasks((prev) =>
                                    prev.map((x) =>
                                      x.id === draft.id
                                        ? { ...x, coPilotIds: [...x.coPilotIds, cpId] }
                                        : x
                                    )
                                  );
                                }}
                                className="px-2 py-0.5 border border-dashed border-slate-300 rounded bg-white text-[11px] text-slate-700 cursor-pointer"
                              >
                                <option value="">+ Ajouter un co-pilote...</option>
                                {availCoPilots.map((u) => (
                                  <option key={u.uid} value={u.uid}>
                                    {u.displayName}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={pShowAmounts}
                    onChange={(e) => setPShowAmounts(e.target.checked)}
                  />
                  Montants budgétaires visibles pour les Responsables
                </label>
                {user.role === 'directeur' && snapshot.settings.migrationModeEnabled && (
                  <label className="flex items-center gap-2 text-xs font-semibold text-indigo-800">
                    <input
                      type="checkbox"
                      checked={pMigration}
                      onChange={(e) => setPMigration(e.target.checked)}
                    />
                    Reprise de l’existant (MIGRATION)
                  </label>
                )}
              </div>

              {pMigration && (
                <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                  <label className="block text-xs font-semibold text-indigo-900 mb-1">
                    Enveloppe budgétaire pré-validée hors outil (optionnel, {snapshot.settings.defaultCurrency} HT)
                  </label>
                  <input
                    type="number"
                    min={0}
                    placeholder="ex. 150000"
                    value={pMigBudgetAmount}
                    onChange={(e) => setPMigBudgetAmount(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-indigo-200 rounded bg-white"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewProject(false)}
                  className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold bg-[#2448C9] text-white rounded-lg hover:bg-[#1d3aa3] cursor-pointer"
                >
                  Créer le projet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Nouvelle Intervention (R12) */}
      {showNewIntervention && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Nouvelle intervention (M3)</h3>
              <button
                type="button"
                onClick={() => setShowNewIntervention(false)}
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {error && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">{error}</div>
            )}
            <form onSubmit={handleCreateIntervention} className="space-y-3">
              <input
                type="text"
                required
                placeholder="Titre de l’intervention"
                value={iTitle}
                onChange={(e) => setITitle(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <textarea
                rows={2}
                placeholder="Description..."
                value={iDesc}
                onChange={(e) => setIDesc(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Lieu / Bâtiment"
                  value={iLoc}
                  onChange={(e) => setILoc(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Demandeur"
                  value={iReq}
                  onChange={(e) => setIReq(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={iPriority}
                  onChange={(e) => setIPriority(e.target.value as Priority)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="critique">Critique</option>
                  <option value="haute">Haute</option>
                  <option value="moyenne">Moyenne</option>
                  <option value="basse">Basse</option>
                </select>
                <select
                  value={iAssignee}
                  onChange={(e) => setIAssignee(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {snapshot.directory
                    .filter((u) => u.status === 'actif' && u.role !== 'administrateur')
                    .map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.displayName}
                      </option>
                    ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  value={iStart}
                  onChange={(e) => setIStart(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <input
                  type="date"
                  value={iEnd}
                  onChange={(e) => setIEnd(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewIntervention(false)}
                  className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold bg-[#2448C9] text-white rounded-lg cursor-pointer"
                >
                  Créer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
