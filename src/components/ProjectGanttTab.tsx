import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarX2,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Play,
  Plus,
  Printer,
  Rocket,
  X,
} from 'lucide-react';
import { api, type WorkspaceSnapshot } from '../services/api';
import {
  addDaysISO,
  computeCascadeShiftPreview,
  computeProjectTree,
  diffCalendarDaysInclusive,
  formatDateFR,
  getISOWeekLabel,
  isWorkedDay,
  resolveScheduleForTask,
  signedVarianceDays,
} from '../shared/calculationEngine';
import type {
  DependencyReaction,
  Priority,
  Project,
  ProjectTask,
  TaskDependency,
  TaskExecutionMode,
} from '../shared/types';
import { ClosingModal } from './ClosingModal';
import { PriorityBadge, TaskStatusBadge, VarianceBadge } from './StatusBadges';

interface ProjectGanttTabProps {
  project: Project;
  snapshot: WorkspaceSnapshot;
  onRefresh: () => void;
}

type GanttScale = 'day' | 'week' | 'month';

export const ProjectGanttTab: React.FC<ProjectGanttTabProps> = ({
  project,
  snapshot,
  onRefresh,
}) => {
  const user = snapshot.currentUser;
  const todayISO = snapshot.effectiveTodayISO;
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

  const [scale, setScale] = useState<GanttScale>('day');
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [showAddTask, setShowAddTask] = useState(false);
  const [parentForNew, setParentForNew] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null);
  const [cascadeTrigger, setCascadeTrigger] = useState<ProjectTask | null>(null);
  const [cascadeEndDate, setCascadeEndDate] = useState('');
  const [cascadeOverrides, setCascadeOverrides] = useState<Record<string, 'sans_impact' | 'decaler'>>({});
  const [closingTask, setClosingTask] = useState<{ task: ProjectTask; er: number } | null>(null);
  const [showBaselineReq, setShowBaselineReq] = useState(false);
  const [baselineReason, setBaselineReason] = useState('');

  // Task creation state
  const [tTitle, setTTitle] = useState('');
  const [tDesc, setTDesc] = useState('');
  const [tPriority, setTPriority] = useState<Priority>('haute');
  const [tStart, setTStart] = useState(todayISO);
  const [tEnd, setTEnd] = useState(addDaysISO(todayISO, 4));
  const [tAssignee, setTAssignee] = useState(
    snapshot.directory.find((u) => u.status === 'actif' && u.role !== 'administrateur')?.uid || user.uid
  );
  const [tCoPilots, setTCoPilots] = useState<string[]>([]);
  const [tMode, setTMode] = useState<TaskExecutionMode>('interne');
  const [tSupplierId, setTSupplierId] = useState('');
  const [tProposeNewSup, setTProposeNewSup] = useState(false);
  const [tSupName, setTSupName] = useState('');
  const [tSupIce, setTSupIce] = useState('');
  const [tDepPred, setTDepPred] = useState('');
  const [tDepReaction, setTDepReaction] = useState<DependencyReaction>('decaler');
  const [tMigDone, setTMigDone] = useState(false);

  const planningPh = project.phases.find((p) => p.key === 'planning');
  const isPlanningLead = planningPh?.stakeholders.some((s) => s.uid === user.uid && s.isLead);
  const canManagePlanning =
    project.status === 'actif' &&
    (project.responsable0Id === user.uid || isPlanningLead || user.role === 'directeur');

  // Visible rows respecting collapse
  const visibleTasks = useMemo(() => {
    const out: ProjectTask[] = [];
    for (const t of tree.orderedTasks) {
      let hidden = false;
      let curPid = t.parentId;
      while (curPid) {
        if (collapsedIds[curPid]) {
          hidden = true;
          break;
        }
        curPid = tree.tasksById[curPid]?.parentId || null;
      }
      if (!hidden) out.push(t);
    }
    return out;
  }, [tree, collapsedIds]);

  // Compute timeline window
  const timelineBounds = useMemo(() => {
    const dates: string[] = [todayISO, project.targetStartDate, project.targetEndDate];
    for (const t of projectTasks) {
      dates.push(t.startDate, t.endDate);
      if (t.refStartDate) dates.push(t.refStartDate);
      if (t.refEndDate) dates.push(t.refEndDate);
      const m = tree.metricsById[t.id];
      if (m?.projectedEndDate) dates.push(m.projectedEndDate);
    }
    const minD = dates.reduce((a, b) => (b < a ? b : a), todayISO);
    const maxD = dates.reduce((a, b) => (b > a ? b : a), todayISO);
    const start = addDaysISO(minD, -3);
    const end = addDaysISO(maxD, 6);
    const totalDays = Math.max(14, diffCalendarDaysInclusive(start, end));
    const days: string[] = [];
    for (let i = 0; i < totalDays; i++) {
      days.push(addDaysISO(start, i));
    }
    return { start, end, totalDays, days };
  }, [projectTasks, tree.metricsById, todayISO, project.targetStartDate, project.targetEndDate]);

  const colWidth = scale === 'day' ? 30 : scale === 'week' ? 14 : 7;
  const rowHeight = 44;
  const chartWidth = timelineBounds.totalDays * colWidth;
  const projectSchedule = resolveScheduleForTask({}, project, snapshot.workSchedules);

  const dayOffsetPx = (dateStr: string) => {
    const idx = diffCalendarDaysInclusive(timelineBounds.start, dateStr) - 1;
    return Math.max(0, idx) * colWidth;
  };

  const spanWidthPx = (s: string, e: string) => {
    const len = Math.max(1, diffCalendarDaysInclusive(s, e));
    return len * colWidth;
  };

  const todayPx = dayOffsetPx(todayISO);

  const cascadePreview = useMemo(() => {
    if (!cascadeTrigger || !cascadeEndDate) return [];
    return computeCascadeShiftPreview(
      cascadeTrigger.id,
      cascadeEndDate,
      cascadeOverrides,
      project,
      projectTasks,
      snapshot.workSchedules,
      snapshot.holidays
    );
  }, [cascadeTrigger, cascadeEndDate, cascadeOverrides, project, projectTasks, snapshot.workSchedules, snapshot.holidays]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const deps: TaskDependency[] = tDepPred
        ? [{ predecessorId: tDepPred, reaction: tDepReaction }]
        : [];
      await api.createTask(project.id, {
        parentId: parentForNew,
        title: tTitle,
        description: tDesc,
        priority: tPriority,
        startDate: tStart,
        endDate: tEnd,
        assigneeId: tAssignee,
        coPilotIds: tCoPilots.filter((id) => id !== tAssignee),
        executionMode: tMode,
        supplierId: tMode === 'externe' && !tProposeNewSup ? tSupplierId || undefined : undefined,
        proposeSupplier:
          tMode === 'externe' && tProposeNewSup
            ? { name: tSupName, ice: tSupIce }
            : undefined,
        dependencies: deps,
        isMigrationCompleted: tMigDone,
        expectedPlanningRevision: project.planningRevision,
      });
      setShowAddTask(false);
      setTTitle('');
      setTDesc('');
      setTCoPilots([]);
      setTDepPred('');
      setTMigDone(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur création tâche');
    }
  };

  const runAction = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur action');
    }
  };

  const rowIndexMap = useMemo(() => {
    const m: Record<string, number> = {};
    visibleTasks.forEach((t, idx) => {
      m[t.id] = idx;
    });
    return m;
  }, [visibleTasks]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            {([
              { id: 'day', label: 'Jour' },
              { id: 'week', label: 'Semaine' },
              { id: 'month', label: 'Mois' },
            ] as const).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setScale(s.id)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md cursor-pointer ${
                  scale === s.id ? 'bg-white text-[#2448C9] shadow-xs' : 'text-slate-600'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="text-xs text-slate-600 tabular-nums">
            Révision planning <span className="font-mono font-semibold">v{project.planningRevision}</span>
            {project.currentBaselineVersion > 0 && (
              <span className="ml-2 font-mono text-[#2448C9] font-semibold">
                · Baseline V{project.currentBaselineVersion}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManagePlanning && (
            <button
              type="button"
              onClick={() => {
                setParentForNew(null);
                setError('');
                setShowAddTask(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#2448C9] text-white rounded-lg hover:bg-[#1d3aa3] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Ajouter une tâche
            </button>
          )}
          {canManagePlanning && !project.planningLaunched && projectTasks.length > 0 && (
            <button
              type="button"
              onClick={() => runAction(() => api.launchPlanning(project.id))}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 cursor-pointer"
            >
              <Rocket className="w-3.5 h-3.5" />
              Lancer le planning (V1)
            </button>
          )}
          {canManagePlanning && project.planningLaunched && (
            <button
              type="button"
              onClick={() => setShowBaselineReq(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-slate-300 text-slate-700 bg-white rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <GitBranch className="w-3.5 h-3.5 text-[#2448C9]" />
              Nouvelle référence
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-slate-300 text-slate-700 bg-white rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Imprimer A3
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">{error}</div>
      )}

      {/* Split Gantt Board */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col lg:flex-row">
        {/* Left Tree Table */}
        <div className="lg:w-[540px] shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 overflow-x-auto">
          <div className="min-w-[520px]">
            <div className="h-11 bg-slate-50 border-b border-slate-200 px-3 grid grid-cols-12 items-center text-[11px] font-bold uppercase text-slate-500">
              <div className="col-span-5">Code / Tâche</div>
              <div className="col-span-1 text-center">D</div>
              <div className="col-span-2 text-center">R / Th</div>
              <div className="col-span-2">Écart</div>
              <div className="col-span-2">Réalisé par</div>
            </div>

            {visibleTasks.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Aucune tâche planifiée. Ajoutez votre première tâche pour construire le Gantt.
              </div>
            ) : (
              visibleTasks.map((task) => {
                const hasChildren = projectTasks.some((x) => x.parentId === task.id);
                const m = tree.metricsById[task.id];
                const isCollapsed = collapsedIds[task.id];
                const indent = task.level === 1 ? '' : task.level === 2 ? 'pl-4' : 'pl-8';
                return (
                  <div
                    key={task.id}
                    style={{ height: rowHeight }}
                    onClick={() => setSelectedTask(task)}
                    className={`px-3 border-b border-slate-100 grid grid-cols-12 items-center text-xs hover:bg-blue-50/40 cursor-pointer tabular-nums ${
                      hasChildren ? 'bg-slate-50/60 font-semibold' : ''
                    } ${selectedTask?.id === task.id ? 'bg-blue-50/70' : ''}`}
                  >
                    <div className={`col-span-5 flex items-center gap-1.5 min-w-0 ${indent}`}>
                      {hasChildren ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCollapsedIds((prev) => ({ ...prev, [task.id]: !prev[task.id] }));
                          }}
                          className="p-0.5 text-slate-500 hover:text-slate-800 cursor-pointer"
                        >
                          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      ) : (
                        <span className="w-4 shrink-0" />
                      )}
                      <span className="font-mono text-[11px] font-bold text-[#2448C9] shrink-0">
                        {task.code}
                      </span>
                      <span className="truncate text-slate-900" title={task.title}>
                        {task.title}
                      </span>
                    </div>
                    <div className="col-span-1 text-center text-slate-600">
                      {m?.durationWorked ?? 0}j
                    </div>
                    <div className="col-span-2 text-center">
                      <span className="font-semibold text-slate-900">{task.progress}%</span>
                      <span className="text-slate-400"> / {m?.theoreticalProgress ?? 0}%</span>
                    </div>
                    <div className="col-span-2 truncate">
                      {m && <VarianceBadge metrics={m} />}
                    </div>
                    <div
                      className="col-span-2 truncate text-[11px] text-slate-600 pl-1"
                      title={[task.assigneeName, ...(task.coPilotNames || [])].join(', ')}
                    >
                      {task.assigneeName}
                      {task.coPilotNames && task.coPilotNames.length > 0 && (
                        <span className="ml-1 text-[10px] font-semibold text-[#2448C9]">
                          +{task.coPilotNames.length}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Timeline Grid */}
        <div className="flex-1 overflow-x-auto relative">
          <div style={{ width: chartWidth }} className="relative">
            {/* Timeline Header */}
            <div className="h-11 bg-slate-50 border-b border-slate-200 flex items-center text-[10px] font-mono text-slate-500 select-none">
              {timelineBounds.days.map((d) => {
                const showLabel =
                  scale === 'day' ||
                  (scale === 'week' && new Date(d + 'T00:00:00Z').getUTCDay() === 1) ||
                  (scale === 'month' && d.endsWith('-01'));
                return (
                  <div
                    key={d}
                    style={{ width: colWidth }}
                    className="h-full border-r border-slate-200/70 flex flex-col items-center justify-center shrink-0"
                  >
                    {showLabel && (
                      <span>
                        {scale === 'day'
                          ? d.slice(8)
                          : scale === 'week'
                          ? getISOWeekLabel(d)
                          : d.slice(5, 7) + '/' + d.slice(2, 4)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Body with vertical non-worked shading, Today line, SVG arrows & task bars */}
            <div
              className="relative"
              style={{ height: Math.max(120, visibleTasks.length * rowHeight) }}
            >
              {/* Non-worked day columns */}
              {timelineBounds.days.map((d, i) => {
                const worked = isWorkedDay(d, projectSchedule, snapshot.holidays);
                const isHoliday = snapshot.holidays.some((h) => h.date === d);
                if (worked) return null;
                return (
                  <div
                    key={d}
                    style={{ left: i * colWidth, width: colWidth }}
                    className={`absolute top-0 bottom-0 pointer-events-none ${
                      isHoliday ? 'bg-amber-100/50' : 'bg-slate-100/80'
                    }`}
                  />
                );
              })}

              {/* Today vertical line */}
              <div
                style={{ left: todayPx }}
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none"
              >
                <div className="bg-red-600 text-white text-[9px] font-mono px-1 rounded-r absolute top-0 left-0 whitespace-nowrap">
                  Auj. {formatDateFR(todayISO).slice(0, 5)}
                </div>
              </div>

              {/* SVG Dependency Arrows */}
              <svg
                width={chartWidth}
                height={Math.max(120, visibleTasks.length * rowHeight)}
                className="absolute inset-0 pointer-events-none z-10"
              >
                {visibleTasks.map((task, idx) =>
                  task.dependencies.map((dep) => {
                    const predIdx = rowIndexMap[dep.predecessorId];
                    const pred = tree.tasksById[dep.predecessorId];
                    if (predIdx === undefined || !pred) return null;
                    const x1 = dayOffsetPx(pred.endDate) + spanWidthPx(pred.endDate, pred.endDate);
                    const y1 = predIdx * rowHeight + rowHeight / 2;
                    const x2 = dayOffsetPx(task.startDate);
                    const y2 = idx * rowHeight + rowHeight / 2;
                    const isConflict = tree.metricsById[task.id]?.conflictPredecessorIds.includes(pred.id);
                    const color = isConflict ? '#DC2626' : dep.reaction === 'decaler' ? '#2448C9' : '#64748B';
                    const midX = x1 + 8;
                    return (
                      <path
                        key={`${pred.id}_${task.id}`}
                        d={`M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`}
                        fill="none"
                        stroke={color}
                        strokeWidth={isConflict ? 2 : 1.5}
                        strokeDasharray={dep.reaction === 'sans_impact' ? '4 2' : undefined}
                      />
                    );
                  })
                )}
              </svg>

              {/* Task Rows */}
              {visibleTasks.map((task, idx) => {
                const hasChildren = projectTasks.some((x) => x.parentId === task.id);
                const m = tree.metricsById[task.id];
                const left = dayOffsetPx(task.startDate);
                const width = spanWidthPx(task.startDate, task.endDate);
                const refLeft = task.refStartDate ? dayOffsetPx(task.refStartDate) : null;
                const refWidth =
                  task.refStartDate && task.refEndDate
                    ? spanWidthPx(task.refStartDate, task.refEndDate)
                    : null;
                const projRight = m?.projectedEndDate ? dayOffsetPx(m.projectedEndDate) + colWidth : null;

                const barColor =
                  task.status === 'annulee'
                    ? 'bg-slate-300'
                    : hasChildren
                    ? 'bg-slate-700'
                    : m?.varianceStatus === 'depasse'
                    ? 'bg-red-500'
                    : m?.varianceStatus === 'retard_projete'
                    ? 'bg-amber-500'
                    : task.status === 'terminee'
                    ? 'bg-emerald-600'
                    : 'bg-[#2448C9]';

                return (
                  <div
                    key={task.id}
                    style={{ top: idx * rowHeight, height: rowHeight }}
                    onClick={() => setSelectedTask(task)}
                    className="absolute left-0 right-0 border-b border-slate-100 cursor-pointer"
                  >
                    {/* Baseline Reference thin gray bar */}
                    {refLeft !== null && refWidth !== null && (
                      <div
                        style={{ left: refLeft, width: refWidth }}
                        className="absolute bottom-1.5 h-1 bg-slate-400/70 rounded-full"
                      />
                    )}

                    {/* Projected dashed extension when late */}
                    {projRight !== null && projRight > left + width && (
                      <div
                        style={{ left: left + width, width: projRight - (left + width) }}
                        className="absolute top-3.5 h-4 border-2 border-dashed border-amber-500 bg-amber-100/50 rounded-r"
                      />
                    )}

                    {/* Main Task Bar */}
                    <div
                      style={{ left, width }}
                      className={`absolute top-2.5 h-5 rounded ${
                        hasChildren ? 'opacity-85' : ''
                      } bg-slate-200 border border-slate-300 overflow-hidden shadow-2xs`}
                    >
                      <div
                        className={`h-full ${barColor}`}
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>

                    {/* Inline badges next to bar */}
                    <div
                      style={{ left: left + width + 6 }}
                      className="absolute top-2.5 flex items-center gap-1.5 text-[10px] whitespace-nowrap"
                    >
                      {task.calendarConflict && (
                        <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-semibold">
                          Conflit calendrier
                        </span>
                      )}
                      {task.executionMode === 'externe' && !task.supplierId && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                          Prestataire à définir
                        </span>
                      )}
                      {task.supplierPendingApproval && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                          Prestataire proposé
                        </span>
                      )}
                      {m?.hasConflict && (
                        <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-semibold">
                          Conflit dépendance
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Selected Task Inspector */}
      {selectedTask && (() => {
        const task = tree.tasksById[selectedTask.id] || selectedTask;
        const m = tree.metricsById[task.id];
        const hasChildren = projectTasks.some((x) => x.parentId === task.id);
        const canAct =
          task.assigneeId === user.uid ||
          Boolean(task.coPilotIds?.includes(user.uid)) ||
          canManagePlanning;
        const availTaskCoPilots = snapshot.directory.filter(
          (u) =>
            u.status === 'actif' &&
            u.role !== 'administrateur' &&
            u.uid !== task.assigneeId &&
            !task.coPilotIds?.includes(u.uid)
        );

        return (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 no-print">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-bold text-[#2448C9]">Tâche {task.code}</span>
                  <PriorityBadge priority={task.priority} />
                  <TaskStatusBadge status={task.status} />
                  {m && <VarianceBadge metrics={m} />}
                </div>
                <h4 className="text-base font-bold text-slate-900 mt-1">{task.title}</h4>
                <p className="text-xs text-slate-600 mt-0.5">
                  {formatDateFR(task.startDate)} → {formatDateFR(task.endDate)} · {m?.durationWorked ?? 0} j ouvrés · Pilote principal :{' '}
                  <strong>{task.assigneeName}</strong>
                  {task.coPilotNames && task.coPilotNames.length > 0 && ` · Co-pilotes : ${task.coPilotNames.join(', ')}`}
                  {task.supplierName && ` · Prestataire : ${task.supplierName}`}
                </p>
                {canManagePlanning && task.status !== 'annulee' && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-[11px] font-medium text-slate-500">Co-pilotes :</span>
                    {(task.coPilotIds || []).map((cpId, idx) => (
                      <span
                        key={cpId}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[11px] text-slate-700"
                      >
                        <span>{task.coPilotNames?.[idx] || cpId}</span>
                        <button
                          type="button"
                          onClick={() =>
                            runAction(() =>
                              api.updateTask(project.id, task.id, {
                                coPilotIds: (task.coPilotIds || []).filter((id) => id !== cpId),
                                expectedPlanningRevision: project.planningRevision,
                              })
                            )
                          }
                          className="text-slate-400 hover:text-red-600 cursor-pointer"
                          title="Retirer ce co-pilote"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    {availTaskCoPilots.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => {
                          const cpId = e.target.value;
                          if (!cpId) return;
                          runAction(() =>
                            api.updateTask(project.id, task.id, {
                              coPilotIds: [...(task.coPilotIds || []), cpId],
                              expectedPlanningRevision: project.planningRevision,
                            })
                          );
                        }}
                        className="px-2 py-0.5 border border-dashed border-slate-300 rounded bg-white text-[11px] text-slate-700 cursor-pointer"
                      >
                        <option value="">+ Ajouter un co-pilote...</option>
                        {availTaskCoPilots.map((u) => (
                          <option key={u.uid} value={u.uid}>
                            {u.displayName}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canManagePlanning && task.level < 3 && task.status !== 'annulee' && (
                  <button
                    type="button"
                    onClick={() => {
                      setParentForNew(task.id);
                      setShowAddTask(true);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    + Sous-tâche
                  </button>
                )}
                {canManagePlanning && !hasChildren && task.status !== 'annulee' && (
                  <button
                    type="button"
                    onClick={() => {
                      setCascadeTrigger(task);
                      setCascadeEndDate(addDaysISO(task.endDate, 2));
                      setCascadeOverrides({});
                    }}
                    className="px-3 py-1.5 text-xs font-semibold border border-amber-300 bg-amber-50 text-amber-900 rounded-lg hover:bg-amber-100 cursor-pointer"
                  >
                    Simuler retard / Cascade (§4.8)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedTask(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {task.calendarConflict && canManagePlanning && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-amber-900">
                  <CalendarX2 className="w-4 h-4 shrink-0" />
                  <span>{task.calendarConflict.reason}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => runAction(() => api.resolveCalendarConflict(project.id, task.id, 'keep'))}
                    className="px-2.5 py-1 bg-white border border-amber-300 text-amber-900 font-semibold rounded cursor-pointer"
                  >
                    Conserver les dates
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(() => api.resolveCalendarConflict(project.id, task.id, 'shift'))}
                    className="px-2.5 py-1 bg-[#2448C9] text-white font-semibold rounded cursor-pointer"
                  >
                    Décaler en jours ouvrés
                  </button>
                </div>
              </div>
            )}

            {!hasChildren && canAct && task.status !== 'annulee' && (
              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
                {task.status !== 'terminee' ? (
                  <>
                    <div className="flex items-center gap-3 flex-1 min-w-[220px]">
                      <span className="text-xs font-bold text-slate-700 w-10 tabular-nums">
                        {task.progress}%
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={95}
                        step={5}
                        value={Math.min(95, task.progress)}
                        onChange={(e) =>
                          runAction(() =>
                            api.taskAction(project.id, task.id, {
                              action: 'progress',
                              progress: Number(e.target.value),
                            })
                          )
                        }
                        className="flex-1 accent-[#2448C9] cursor-pointer"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {(task.status === 'a_faire' || task.status === 'en_attente') && (
                        <button
                          type="button"
                          onClick={() => runAction(() => api.taskAction(project.id, task.id, { action: 'start' }))}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-[#2448C9] text-white rounded-lg cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5" />
                          Démarrer
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const sched = resolveScheduleForTask(task, project, snapshot.workSchedules);
                          const er = signedVarianceDays(todayISO, task.endDate, sched, snapshot.holidays);
                          setClosingTask({ task, er });
                        }}
                        className="px-3 py-1.5 text-xs font-semibold bg-emerald-700 text-white rounded-lg cursor-pointer"
                      >
                        Clôturer (100 %)
                      </button>
                      {canManagePlanning && (
                        <button
                          type="button"
                          onClick={() =>
                            runAction(() =>
                              api.taskAction(project.id, task.id, {
                                action: 'cancel',
                                reason: 'Annulation depuis le planning',
                              })
                            )
                          }
                          className="px-3 py-1.5 text-xs font-medium text-red-700 border border-red-200 rounded-lg hover:bg-red-50 cursor-pointer"
                        >
                          Annuler tâche
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  canManagePlanning && (
                    <button
                      type="button"
                      onClick={() => runAction(() => api.taskAction(project.id, task.id, { action: 'reopen' }))}
                      className="px-3 py-1.5 text-xs font-semibold border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      Réouvrir la tâche (95 %)
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Modal Création tâche */}
      {showAddTask && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {parentForNew ? 'Nouvelle sous-tâche' : 'Nouvelle tâche principale'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddTask(false)}
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateTask} className="space-y-3">
              <input
                type="text"
                required
                placeholder="Titre de la tâche"
                value={tTitle}
                onChange={(e) => setTTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <textarea
                rows={2}
                placeholder="Description..."
                value={tDesc}
                onChange={(e) => setTDesc(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Début</label>
                  <input
                    type="date"
                    required
                    value={tStart}
                    onChange={(e) => setTStart(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Fin</label>
                  <input
                    type="date"
                    required
                    value={tEnd}
                    onChange={(e) => setTEnd(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={tPriority}
                  onChange={(e) => setTPriority(e.target.value as Priority)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="critique">Priorité Critique</option>
                  <option value="haute">Priorité Haute</option>
                  <option value="moyenne">Priorité Moyenne</option>
                  <option value="basse">Priorité Basse</option>
                </select>
                <select
                  value={tAssignee}
                  onChange={(e) => {
                    const nextAssignee = e.target.value;
                    setTAssignee(nextAssignee);
                    setTCoPilots((prev) => prev.filter((id) => id !== nextAssignee));
                  }}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {snapshot.directory
                    .filter((u) => u.status === 'actif' && u.role !== 'administrateur')
                    .map((u) => (
                      <option key={u.uid} value={u.uid}>
                        Pilote : {u.displayName}
                      </option>
                    ))}
                </select>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-[11px] font-semibold text-slate-600">Co-pilotes (optionnel) :</span>
                {tCoPilots.map((cpId) => {
                  const u = snapshot.directory.find((d) => d.uid === cpId);
                  return (
                    <span
                      key={cpId}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-slate-200 text-[11px] text-slate-700"
                    >
                      <span>{u?.displayName || cpId}</span>
                      <button
                        type="button"
                        onClick={() => setTCoPilots((prev) => prev.filter((id) => id !== cpId))}
                        className="text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
                <select
                  value=""
                  onChange={(e) => {
                    const cpId = e.target.value;
                    if (!cpId) return;
                    setTCoPilots((prev) => (prev.includes(cpId) ? prev : [...prev, cpId]));
                  }}
                  className="px-2 py-1 border border-dashed border-slate-300 rounded bg-white text-[11px] text-slate-700 cursor-pointer"
                >
                  <option value="">+ Ajouter un co-pilote...</option>
                  {snapshot.directory
                    .filter(
                      (u) =>
                        u.status === 'actif' &&
                        u.role !== 'administrateur' &&
                        u.uid !== tAssignee &&
                        !tCoPilots.includes(u.uid)
                    )
                    .map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.displayName}
                      </option>
                    ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={tMode}
                  onChange={(e) => setTMode(e.target.value as TaskExecutionMode)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="interne">Exécution Interne</option>
                  <option value="externe">Exécution Externe (Prestataire)</option>
                </select>
                <select
                  value={tDepPred}
                  onChange={(e) => setTDepPred(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">Sans prédécesseur</option>
                  {projectTasks.map((pt) => (
                    <option key={pt.id} value={pt.id}>
                      Dépend de {pt.code} · {pt.title}
                    </option>
                  ))}
                </select>
              </div>

              {tDepPred && (
                <select
                  value={tDepReaction}
                  onChange={(e) => setTDepReaction(e.target.value as DependencyReaction)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="decaler">Réaction en cas de retard : Décaler automatiquement</option>
                  <option value="sans_impact">Réaction en cas de retard : Sans impact (alerte conflit)</option>
                </select>
              )}

              {tMode === 'externe' && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={tProposeNewSup}
                      onChange={(e) => setTProposeNewSup(e.target.checked)}
                    />
                    Proposer un nouveau prestataire (à vérifier par les Achats)
                  </label>
                  {!tProposeNewSup ? (
                    <select
                      value={tSupplierId}
                      onChange={(e) => setTSupplierId(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded bg-white"
                    >
                      <option value="">Prestataire à définir ultérieurement</option>
                      {snapshot.suppliers
                        .filter((s) => s.status !== 'inactif')
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.status === 'a_verifier' ? 'À vérifier' : 'Qualifié'})
                          </option>
                        ))}
                    </select>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        required
                        placeholder="Raison sociale"
                        value={tSupName}
                        onChange={(e) => setTSupName(e.target.value)}
                        className="px-2.5 py-1.5 text-sm border border-slate-300 rounded bg-white"
                      />
                      <input
                        type="text"
                        required
                        placeholder="ICE"
                        value={tSupIce}
                        onChange={(e) => setTSupIce(e.target.value)}
                        className="px-2.5 py-1.5 text-sm border border-slate-300 rounded bg-white font-mono"
                      />
                    </div>
                  )}
                </div>
              )}

              {project.migration?.isMigrated && !project.planningLaunched && (
                <label className="flex items-center gap-2 text-xs font-semibold text-indigo-800">
                  <input
                    type="checkbox"
                    checked={tMigDone}
                    onChange={(e) => setTMigDone(e.target.checked)}
                  />
                  Tâche historique déjà terminée à 100 % (Reprise de l’existant)
                </label>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddTask(false)}
                  className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold bg-[#2448C9] text-white rounded-lg cursor-pointer"
                >
                  Ajouter au Gantt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Cascade §4.8 */}
      {cascadeTrigger && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                Propagation de retard — {cascadeTrigger.code} {cascadeTrigger.title}
              </h3>
              <button
                type="button"
                onClick={() => setCascadeTrigger(null)}
                className="p-1 text-slate-400 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nouvelle date de fin estimée
              </label>
              <input
                type="date"
                value={cascadeEndDate}
                onChange={(e) => setCascadeEndDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div className="border border-slate-200 rounded-lg p-3 space-y-2 max-h-56 overflow-y-auto">
              <div className="text-xs font-bold text-slate-700">
                Prévisualisation des tâches impactées ({cascadePreview.length}) :
              </div>
              {cascadePreview.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Aucune tâche « À faire » en aval décalée pour cette date.
                </p>
              ) : (
                cascadePreview.map((item) => (
                  <div key={item.taskId} className="text-xs flex items-center justify-between py-1 border-b border-slate-100 last:border-0 tabular-nums">
                    <div>
                      <span className="font-mono font-bold text-[#2448C9] mr-1.5">{item.code}</span>
                      <span className="font-medium text-slate-900">{item.title}</span>
                    </div>
                    <div className="text-slate-600">
                      {formatDateFR(item.oldStartDate)} → <strong className="text-amber-700">{formatDateFR(item.newStartDate)}..{formatDateFR(item.newEndDate)}</strong>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCascadeTrigger(null)}
                className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={async () => {
                  await runAction(() =>
                    api.applyCascade(project.id, cascadeTrigger.id, cascadeEndDate, cascadeOverrides)
                  );
                  setCascadeTrigger(null);
                }}
                className="px-4 py-2 text-sm font-semibold bg-[#2448C9] text-white rounded-lg cursor-pointer"
              >
                Appliquer le décalage
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Demande Nouvelle Référence (D11) */}
      {showBaselineReq && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Demande de nouvelle référence planning</h3>
            <textarea
              rows={3}
              placeholder="Motif du re-baselining (sera soumis à la Direction)..."
              value={baselineReason}
              onChange={(e) => setBaselineReason(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowBaselineReq(false)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!baselineReason.trim()) return;
                  await runAction(() => api.requestBaseline(project.id, baselineReason));
                  setBaselineReason('');
                  setShowBaselineReq(false);
                }}
                className="px-4 py-1.5 text-sm font-semibold bg-[#2448C9] text-white rounded-lg cursor-pointer"
              >
                Soumettre
              </button>
            </div>
          </div>
        </div>
      )}

      {closingTask && (
        <ClosingModal
          code={`${project.code} · ${closingTask.task.code}`}
          title={closingTask.task.title}
          plannedEndDate={closingTask.task.endDate}
          effectiveTodayISO={todayISO}
          computedEr={closingTask.er}
          onClose={() => setClosingTask(null)}
          onConfirm={async (justif) => {
            await api.taskAction(project.id, closingTask.task.id, {
              action: 'complete',
              delayJustification: justif,
            });
            onRefresh();
          }}
        />
      )}
    </div>
  );
};
