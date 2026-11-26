import type {
  ComputedTaskMetrics,
  HolidayEntry,
  Project,
  ProjectTask,
  TaskStatus,
  WorkSchedule,
} from './types.ts';
import { PRIORITY_ORDER } from './types.ts';

export function parseDateUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
}

export function formatDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysISO(dateStr: string, days: number): string {
  const d = parseDateUTC(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateUTC(d);
}

export function diffCalendarDaysInclusive(startStr: string, endStr: string): number {
  const a = parseDateUTC(startStr).getTime();
  const b = parseDateUTC(endStr).getTime();
  if (b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

export function getCasablancaTodayISO(overrideDate?: string): string {
  if (overrideDate && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(overrideDate)) {
    return overrideDate;
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Casablanca',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

export function getISOWeekLabel(dateStr: string): string {
  const d = parseDateUTC(dateStr);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `S${String(weekNo).padStart(2, '0')}`;
}

export function formatDateFR(dateStr?: string): string {
  if (!dateStr || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateStr)) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export function formatAmountMAD(amount: number, currency = 'MAD'): string {
  const formatted = amount
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formatted} ${currency}`;
}

export function roundHalfUp(val: number): number {
  return Math.floor(val + 0.5);
}

export function isWorkedDay(
  dateStr: string,
  schedule: WorkSchedule,
  holidays: HolidayEntry[]
): boolean {
  const d = parseDateUTC(dateStr);
  const dow = d.getUTCDay();
  if (!schedule.workingDays.includes(dow)) {
    return false;
  }
  for (const period of schedule.periods || []) {
    if (period.type === 'arret' && dateStr >= period.startDate && dateStr <= period.endDate) {
      return false;
    }
  }
  if (schedule.applyHolidays) {
    if (holidays.some((h) => h.date === dateStr)) {
      return false;
    }
  }
  return true;
}

/**
 * N(a, b): Number of worked days according to schedule between a and b inclusive.
 * N(a, b) = 0 if b < a.
 */
export function countWorkedDays(
  startStr: string,
  endStr: string,
  schedule: WorkSchedule,
  holidays: HolidayEntry[]
): number {
  if (!startStr || !endStr || endStr < startStr) return 0;
  let count = 0;
  let cur = startStr;
  let guard = 0;
  while (cur <= endStr && guard < 2000) {
    if (isWorkedDay(cur, schedule, holidays)) {
      count += 1;
    }
    cur = addDaysISO(cur, 1);
    guard += 1;
  }
  return count;
}

/**
 * Signed variance Delta(a, b) on applicable schedule (§5.4).
 * Positive = ahead (b > a), 0 = on time (b == a), negative = late (b < a).
 */
export function signedVarianceDays(
  aStr: string,
  bStr: string,
  schedule: WorkSchedule,
  holidays: HolidayEntry[]
): number {
  if (bStr === aStr) return 0;
  if (bStr > aStr) {
    return countWorkedDays(addDaysISO(aStr, 1), bStr, schedule, holidays);
  }
  return -countWorkedDays(addDaysISO(bStr, 1), aStr, schedule, holidays);
}

export function nextWorkedDayOnOrAfter(
  dateStr: string,
  schedule: WorkSchedule,
  holidays: HolidayEntry[]
): string {
  let cur = dateStr;
  for (let i = 0; i < 365; i++) {
    if (isWorkedDay(cur, schedule, holidays)) return cur;
    cur = addDaysISO(cur, 1);
  }
  return dateStr;
}

export function nextWorkedDayStrictlyAfter(
  dateStr: string,
  schedule: WorkSchedule,
  holidays: HolidayEntry[]
): string {
  return nextWorkedDayOnOrAfter(addDaysISO(dateStr, 1), schedule, holidays);
}

/**
 * Nth worked day starting from startDate (rank 1 = startDate if worked).
 */
export function nthWorkedDayFrom(
  startStr: string,
  rank: number,
  schedule: WorkSchedule,
  holidays: HolidayEntry[]
): string {
  const targetRank = Math.max(1, rank);
  let cur = startStr;
  let count = 0;
  for (let i = 0; i < 1500; i++) {
    if (isWorkedDay(cur, schedule, holidays)) {
      count += 1;
      if (count >= targetRank) return cur;
    }
    cur = addDaysISO(cur, 1);
  }
  return cur;
}

export function resolveScheduleForTask(
  task: Pick<ProjectTask, 'workScheduleId'>,
  project: Pick<Project, 'workScheduleId'>,
  schedules: WorkSchedule[]
): WorkSchedule {
  const id = task.workScheduleId || project.workScheduleId;
  return (
    schedules.find((s) => s.id === id) ||
    schedules.find((s) => s.isDefault) ||
    schedules[0] || {
      id: 'sched_ouvres',
      name: 'Jours ouvrés',
      workingDays: [1, 2, 3, 4, 5],
      applyHolidays: true,
      periods: [],
      active: true,
      isDefault: true,
    }
  );
}

export function computeLeafTaskMetrics(
  task: ProjectTask,
  project: Project,
  allProjectTasks: ProjectTask[],
  schedules: WorkSchedule[],
  holidays: HolidayEntry[],
  todayISO: string
): ComputedTaskMetrics {
  const schedule = resolveScheduleForTask(task, project, schedules);
  const durationWorked = countWorkedDays(task.startDate, task.endDate, schedule, holidays);
  const durationCalendar = diffCalendarDaysInclusive(task.startDate, task.endDate);
  const refEnd = task.refEndDate || task.endDate;

  if (task.status === 'annulee') {
    return {
      durationWorked,
      durationCalendar,
      theoreticalProgress: 0,
      effectiveStart: task.startDate,
      er: null,
      erRef: null,
      ec: null,
      ecRef: null,
      ep: null,
      epRef: null,
      projectedEndDate: null,
      displayVariance: null,
      displayVarianceOfficial: null,
      varianceStatus: 'neutre',
      varianceLabel: 'Annulée',
      isLate: false,
      hasConflict: false,
      conflictPredecessorIds: [],
      delayedLeavesCount: 0,
    };
  }

  let thRaw = 0;
  if (durationWorked > 0) {
    if (todayISO <= task.startDate) {
      thRaw = 0;
    } else if (todayISO > task.endDate) {
      thRaw = 100;
    } else {
      const elapsed = countWorkedDays(task.startDate, addDaysISO(todayISO, -1), schedule, holidays);
      thRaw = (elapsed / durationWorked) * 100;
    }
  }
  const theoreticalProgress = roundHalfUp(thRaw);
  const effectiveStart =
    task.actualStartDate && task.actualStartDate < task.startDate
      ? task.actualStartDate
      : task.actualStartDate || task.startDate;

  if (task.status === 'terminee' && task.actualEndDate) {
    const er =
      typeof task.frozenEr === 'number'
        ? task.frozenEr
        : signedVarianceDays(task.actualEndDate, task.endDate, schedule, holidays);
    const erRef =
      typeof task.frozenErRef === 'number'
        ? task.frozenErRef
        : signedVarianceDays(task.actualEndDate, refEnd, schedule, holidays);

    let varianceStatus: ComputedTaskMetrics['varianceStatus'] = 'a_lheure';
    let varianceLabel = '0 j · à l\'heure';
    if (er > 0) {
      varianceStatus = 'avance';
      varianceLabel = `+${er} j · en avance`;
    } else if (er < 0) {
      varianceStatus = 'retard_projete';
      varianceLabel = `${er} j · en retard`;
    }

    return {
      durationWorked,
      durationCalendar,
      theoreticalProgress,
      effectiveStart,
      er,
      erRef,
      ec: null,
      ecRef: null,
      ep: null,
      epRef: null,
      projectedEndDate: task.actualEndDate,
      displayVariance: er,
      displayVarianceOfficial: erRef,
      varianceStatus,
      varianceLabel,
      isLate: false,
      hasConflict: false,
      conflictPredecessorIds: [],
      delayedLeavesCount: er < 0 ? 1 : 0,
    };
  }

  // Non-terminated leaf task
  const ec = todayISO > task.endDate ? signedVarianceDays(todayISO, task.endDate, schedule, holidays) : null;
  const ecRef = todayISO > refEnd ? signedVarianceDays(todayISO, refEnd, schedule, holidays) : null;

  let ep: number | null = null;
  let epRef: number | null = null;
  let projectedEndDate: string | null = null;

  const elapsedSinceEffStart = countWorkedDays(
    effectiveStart,
    addDaysISO(todayISO, -1),
    schedule,
    holidays
  );

  if (task.status !== 'a_faire' && task.progress > 0 && elapsedSinceEffStart >= 1) {
    const rank = Math.ceil((elapsedSinceEffStart * 100) / task.progress);
    projectedEndDate = nthWorkedDayFrom(effectiveStart, rank, schedule, holidays);
    let rawEp = signedVarianceDays(projectedEndDate, task.endDate, schedule, holidays);
    if (ec !== null && rawEp > ec) {
      rawEp = ec;
    }
    ep = rawEp;

    let rawEpRef = signedVarianceDays(projectedEndDate, refEnd, schedule, holidays);
    if (ecRef !== null && rawEpRef > ecRef) {
      rawEpRef = ecRef;
    }
    epRef = rawEpRef;
  }

  const displayVariance = ec !== null ? ec : ep;
  const displayVarianceOfficial = ecRef !== null ? ecRef : epRef;

  let varianceStatus: ComputedTaskMetrics['varianceStatus'] = 'neutre';
  let varianceLabel = '—';

  if (ec !== null) {
    varianceStatus = 'depasse';
    varianceLabel = `${ec} j · échéance dépassée`;
  } else if (ep !== null) {
    if (ep > 0) {
      varianceStatus = 'avance';
      varianceLabel = `+${ep} j projeté · avance`;
    } else if (ep === 0) {
      varianceStatus = 'a_lheure';
      varianceLabel = '0 j · Dans les temps';
    } else {
      varianceStatus = 'retard_projete';
      varianceLabel = `${ep} j projeté · retard`;
    }
  } else if (task.progress === 0 && elapsedSinceEffStart >= 1 && todayISO >= task.startDate) {
    varianceStatus = 'non_demarree';
    varianceLabel = 'Non démarrée';
  }

  const isLate = (ep !== null && ep < 0) || todayISO > task.endDate;

  // Check dependency conflicts (Sans impact)
  const conflictPredecessorIds: string[] = [];
  for (const dep of task.dependencies) {
    if (dep.reaction !== 'sans_impact') continue;
    const pred = allProjectTasks.find((t) => t.id === dep.predecessorId);
    if (!pred || pred.status === 'annulee') continue;
    let predEnd = pred.endDate;
    if (pred.status === 'terminee' && pred.actualEndDate) {
      predEnd = pred.actualEndDate;
    } else if (pred.status !== 'terminee') {
      // Check projected end of pred
      const predSched = resolveScheduleForTask(pred, project, schedules);
      const predEffStart = pred.actualStartDate || pred.startDate;
      const predElapsed = countWorkedDays(
        predEffStart,
        addDaysISO(todayISO, -1),
        predSched,
        holidays
      );
      if (pred.progress > 0 && predElapsed >= 1) {
        const predProj = nthWorkedDayFrom(
          predEffStart,
          Math.ceil((predElapsed * 100) / pred.progress),
          predSched,
          holidays
        );
        if (predProj > predEnd) predEnd = predProj;
      }
      if (todayISO > predEnd) predEnd = todayISO;
    }
    if (predEnd >= task.startDate) {
      conflictPredecessorIds.push(pred.id);
    }
  }

  return {
    durationWorked,
    durationCalendar,
    theoreticalProgress,
    effectiveStart,
    er: null,
    erRef: null,
    ec,
    ecRef,
    ep,
    epRef,
    projectedEndDate,
    displayVariance,
    displayVarianceOfficial,
    varianceStatus,
    varianceLabel,
    isLate,
    hasConflict: conflictPredecessorIds.length > 0,
    conflictPredecessorIds,
    delayedLeavesCount: 0,
  };
}

export interface ComputedProjectTree {
  tasksById: Record<string, ProjectTask>;
  metricsById: Record<string, ComputedTaskMetrics>;
  rawProgressById: Record<string, number>;
  rawThById: Record<string, number>;
  orderedTasks: ProjectTask[];
  projectProgress: number;
  projectTheoretical: number;
  projectOfficialVariance: number | null;
  projectStatusComputed: 'a_faire' | 'en_cours' | 'terminee' | 'annulee';
  lateLeavesCount: number;
  delayedCompletedCount: number;
}

export function computeProjectTree(
  project: Project,
  rawTasks: ProjectTask[],
  schedules: WorkSchedule[],
  holidays: HolidayEntry[],
  todayISO: string
): ComputedProjectTree {
  const tasksMap: Record<string, ProjectTask> = {};
  rawTasks.forEach((t) => {
    tasksMap[t.id] = { ...t };
  });

  const childrenMap: Record<string, string[]> = {};
  rawTasks.forEach((t) => {
    const pid = t.parentId || 'ROOT';
    if (!childrenMap[pid]) childrenMap[pid] = [];
    childrenMap[pid].push(t.id);
  });

  const metricsById: Record<string, ComputedTaskMetrics> = {};
  const rawProgressById: Record<string, number> = {};
  const rawThById: Record<string, number> = {};

  function computeNode(taskId: string): void {
    const childIds = childrenMap[taskId] || [];
    if (childIds.length === 0) {
      const task = tasksMap[taskId];
      const schedule = resolveScheduleForTask(task, project, schedules);
      const durationWorked = countWorkedDays(task.startDate, task.endDate, schedule, holidays);

      let thExact = 0;
      if (task.status !== 'annulee' && durationWorked > 0) {
        if (todayISO > task.endDate) thExact = 100;
        else if (todayISO > task.startDate) {
          const elapsed = countWorkedDays(task.startDate, addDaysISO(todayISO, -1), schedule, holidays);
          thExact = (elapsed / durationWorked) * 100;
        }
      }

      rawProgressById[taskId] = task.progress;
      rawThById[taskId] = thExact;
      metricsById[taskId] = computeLeafTaskMetrics(
        task,
        project,
        rawTasks,
        schedules,
        holidays,
        todayISO
      );
      return;
    }

    // Parent task: compute children first (bottom-up §5.5)
    childIds.forEach(computeNode);
    const parent = tasksMap[taskId];
    const children = childIds.map((id) => tasksMap[id]);
    const activeChildren = children.filter((c) => c.status !== 'annulee');

    if (activeChildren.length === 0) {
      parent.status = 'annulee';
      parent.progress = 0;
      rawProgressById[taskId] = 0;
      rawThById[taskId] = 0;
      metricsById[taskId] = {
        durationWorked: 0,
        durationCalendar: 0,
        theoreticalProgress: 0,
        effectiveStart: parent.startDate,
        er: null,
        erRef: null,
        ec: null,
        ecRef: null,
        ep: null,
        epRef: null,
        projectedEndDate: null,
        displayVariance: null,
        displayVarianceOfficial: null,
        varianceStatus: 'neutre',
        varianceLabel: 'Annulée',
        isLate: false,
        hasConflict: false,
        conflictPredecessorIds: [],
        delayedLeavesCount: 0,
      };
      return;
    }

    // Derive dates from non-cancelled children
    parent.startDate = activeChildren.reduce(
      (min, c) => (c.startDate < min ? c.startDate : min),
      activeChildren[0].startDate
    );
    parent.endDate = activeChildren.reduce(
      (max, c) => (c.endDate > max ? c.endDate : max),
      activeChildren[0].endDate
    );

    const schedule = resolveScheduleForTask(parent, project, schedules);
    let weightedR = 0;
    let weightedTh = 0;
    let totalWeight = 0;

    for (const child of activeChildren) {
      const w = metricsById[child.id].durationWorked;
      weightedR += (rawProgressById[child.id] || 0) * w;
      weightedTh += (rawThById[child.id] || 0) * w;
      totalWeight += w;
    }

    const rExact = totalWeight > 0 ? weightedR / totalWeight : 0;
    const thExact = totalWeight > 0 ? weightedTh / totalWeight : 0;
    rawProgressById[taskId] = rExact;
    rawThById[taskId] = thExact;
    parent.progress = roundHalfUp(rExact);

    // Derive status bottom-up (§5.5)
    let derivedStatus: TaskStatus = 'en_cours';
    if (activeChildren.every((c) => c.status === 'terminee')) {
      derivedStatus = 'terminee';
      const maxActualEnd = activeChildren.reduce(
        (max, c) => (c.actualEndDate && c.actualEndDate > max ? c.actualEndDate : max),
        activeChildren[0].actualEndDate || ''
      );
      parent.actualEndDate = maxActualEnd || undefined;
    } else if (activeChildren.every((c) => c.status === 'a_faire')) {
      derivedStatus = 'a_faire';
    } else {
      derivedStatus = 'en_cours';
    }
    parent.status = derivedStatus;

    // Derive variance from non-terminated leaves under this subtree
    let minVar: number | null = null;
    let minOfficialVar: number | null = null;
    let delayedLeavesCount = 0;
    let anyLate = false;

    const collectLeafVars = (nid: string) => {
      const kids = childrenMap[nid] || [];
      if (kids.length === 0) {
        const leaf = tasksMap[nid];
        const m = metricsById[nid];
        if (leaf.status === 'terminee' && (m.er ?? 0) < 0) {
          delayedLeavesCount += 1;
        }
        if (leaf.status !== 'terminee' && leaf.status !== 'annulee') {
          if (leaf.startDate <= todayISO || leaf.actualStartDate) {
            if (m.displayVariance !== null && (minVar === null || m.displayVariance < minVar)) {
              minVar = m.displayVariance;
            }
            if (
              m.displayVarianceOfficial !== null &&
              (minOfficialVar === null || m.displayVarianceOfficial < minOfficialVar)
            ) {
              minOfficialVar = m.displayVarianceOfficial;
            }
          }
          if (m.isLate) anyLate = true;
        }
        return;
      }
      kids.forEach(collectLeafVars);
    };
    collectLeafVars(taskId);

    const parentDurWorked = countWorkedDays(parent.startDate, parent.endDate, schedule, holidays);
    const parentDurCal = diffCalendarDaysInclusive(parent.startDate, parent.endDate);

    let er: number | null = null;
    let erRef: number | null = null;
    let varianceStatus: ComputedTaskMetrics['varianceStatus'] = 'neutre';
    let varianceLabel = '—';

    if (derivedStatus === 'terminee' && parent.actualEndDate) {
      er = signedVarianceDays(parent.actualEndDate, parent.endDate, schedule, holidays);
      const pRefEnd = parent.refEndDate || parent.endDate;
      erRef = signedVarianceDays(parent.actualEndDate, pRefEnd, schedule, holidays);
      minVar = er;
      minOfficialVar = erRef;
      if (er > 0) {
        varianceStatus = 'avance';
        varianceLabel = `+${er} j · en avance`;
      } else if (er === 0) {
        varianceStatus = 'a_lheure';
        varianceLabel = '0 j · à l\'heure';
      } else {
        varianceStatus = 'retard_projete';
        varianceLabel = `${er} j · en retard`;
      }
    } else if (minVar !== null) {
      if (minVar > 0) {
        varianceStatus = 'avance';
        varianceLabel = `+${minVar} j projeté`;
      } else if (minVar === 0) {
        varianceStatus = 'a_lheure';
        varianceLabel = '0 j · Dans les temps';
      } else {
        varianceStatus = 'retard_projete';
        varianceLabel = `${minVar} j projeté`;
      }
    }

    metricsById[taskId] = {
      durationWorked: parentDurWorked,
      durationCalendar: parentDurCal,
      theoreticalProgress: roundHalfUp(thExact),
      effectiveStart: parent.startDate,
      er,
      erRef,
      ec: null,
      ecRef: null,
      ep: minVar,
      epRef: minOfficialVar,
      projectedEndDate: null,
      displayVariance: minVar,
      displayVarianceOfficial: minOfficialVar,
      varianceStatus,
      varianceLabel,
      isLate: anyLate,
      hasConflict: activeChildren.some((c) => metricsById[c.id].hasConflict),
      conflictPredecessorIds: [],
      delayedLeavesCount,
    };
  }

  const rootIds = childrenMap['ROOT'] || [];
  rootIds.forEach(computeNode);

  // Build priority-sorted tree order (§5.6)
  const orderedTasks: ProjectTask[] = [];
  const sortIds = (ids: string[]) =>
    [...ids].sort((idA, idB) => {
      const a = tasksMap[idA];
      const b = tasksMap[idB];
      const pa = PRIORITY_ORDER[a.priority] || 0;
      const pb = PRIORITY_ORDER[b.priority] || 0;
      if (pa !== pb) return pb - pa;
      if (a.endDate !== b.endDate) return a.endDate.localeCompare(b.endDate);
      return a.code.localeCompare(b.code, undefined, { numeric: true });
    });

  const walk = (parentId: string) => {
    const kids = sortIds(childrenMap[parentId] || []);
    for (const id of kids) {
      orderedTasks.push(tasksMap[id]);
      walk(id);
    }
  };
  walk('ROOT');

  // Project-level aggregates from active top-level tasks (§5.5)
  const activeRoots = rootIds
    .map((id) => tasksMap[id])
    .filter((t) => t.status !== 'annulee');
  let pR = 0;
  let pTh = 0;
  let pW = 0;
  for (const r of activeRoots) {
    const w = metricsById[r.id].durationWorked;
    pR += (rawProgressById[r.id] || 0) * w;
    pTh += (rawThById[r.id] || 0) * w;
    pW += w;
  }

  const projectProgress = pW > 0 ? roundHalfUp(pR / pW) : 0;
  const projectTheoretical = pW > 0 ? roundHalfUp(pTh / pW) : 0;

  let projectOfficialVariance: number | null = null;
  let lateLeavesCount = 0;
  let delayedCompletedCount = 0;

  rawTasks.forEach((orig) => {
    if (childrenMap[orig.id]?.length) return; // only leaves
    const t = tasksMap[orig.id];
    const m = metricsById[orig.id];
    if (t.status === 'annulee') return;
    if (t.status === 'terminee') {
      if ((m.er ?? 0) < 0) delayedCompletedCount += 1;
      return;
    }
    if (m.isLate) lateLeavesCount += 1;
    if (t.startDate <= todayISO || t.actualStartDate) {
      if (
        m.displayVarianceOfficial !== null &&
        (projectOfficialVariance === null || m.displayVarianceOfficial < projectOfficialVariance)
      ) {
        projectOfficialVariance = m.displayVarianceOfficial;
      }
    }
  });

  let projectStatusComputed: ComputedProjectTree['projectStatusComputed'] = 'a_faire';
  if (rootIds.length > 0 && activeRoots.length === 0) {
    projectStatusComputed = 'annulee';
  } else if (activeRoots.length > 0 && activeRoots.every((r) => r.status === 'terminee')) {
    projectStatusComputed = 'terminee';
  } else if (activeRoots.some((r) => r.status === 'en_cours' || r.status === 'terminee' || r.status === 'en_attente')) {
    projectStatusComputed = 'en_cours';
  }

  return {
    tasksById: tasksMap,
    metricsById,
    rawProgressById,
    rawThById,
    orderedTasks,
    projectProgress,
    projectTheoretical,
    projectOfficialVariance,
    projectStatusComputed,
    lateLeavesCount,
    delayedCompletedCount,
  };
}

/**
 * §4.7 Cycle detection before adding predecessorId -> targetTaskId
 */
export function wouldCreateCycle(
  tasks: ProjectTask[],
  predecessorId: string,
  targetTaskId: string
): boolean {
  if (predecessorId === targetTaskId) return true;
  // Walk backwards from predecessorId through its dependencies to see if targetTaskId is an ancestor
  const visited = new Set<string>();
  const stack = [predecessorId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === targetTaskId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const t = tasks.find((x) => x.id === cur);
    if (!t) continue;
    for (const dep of t.dependencies) {
      stack.push(dep.predecessorId);
    }
  }
  return false;
}

export interface CascadeShiftPreviewItem {
  taskId: string;
  code: string;
  title: string;
  oldStartDate: string;
  oldEndDate: string;
  newStartDate: string;
  newEndDate: string;
  durationWorked: number;
  scheduleName: string;
}

/**
 * §4.8 Multi-program calendar-date cascade delay algorithm.
 * Never shifts started, terminated, or cancelled tasks.
 */
export function computeCascadeShiftPreview(
  triggerTaskId: string,
  triggerNewEndDate: string,
  overrideReactions: Record<string, 'sans_impact' | 'decaler'>,
  project: Project,
  allTasks: ProjectTask[],
  schedules: WorkSchedule[],
  holidays: HolidayEntry[]
): CascadeShiftPreviewItem[] {
  const effectiveEnd: Record<string, string> = {};
  const workingCopy: Record<string, ProjectTask> = {};

  for (const t of allTasks) {
    workingCopy[t.id] = { ...t };
    if (t.id === triggerTaskId) {
      effectiveEnd[t.id] = triggerNewEndDate;
    } else if (t.status === 'terminee' && t.actualEndDate) {
      effectiveEnd[t.id] = t.actualEndDate;
    } else {
      effectiveEnd[t.id] = t.endDate;
    }
  }

  // Topological sort on dependency edges
  const inDegree: Record<string, number> = {};
  const dependents: Record<string, { taskId: string; reaction: 'sans_impact' | 'decaler' }[]> = {};
  allTasks.forEach((t) => {
    inDegree[t.id] = 0;
    dependents[t.id] = [];
  });
  allTasks.forEach((t) => {
    t.dependencies.forEach((dep) => {
      const reaction =
        dep.predecessorId === triggerTaskId && overrideReactions[t.id]
          ? overrideReactions[t.id]
          : dep.reaction;
      if (dependents[dep.predecessorId]) {
        dependents[dep.predecessorId].push({ taskId: t.id, reaction });
      }
      inDegree[t.id] = (inDegree[t.id] || 0) + 1;
    });
  });

  const queue: string[] = [];
  Object.keys(inDegree).forEach((id) => {
    if (inDegree[id] === 0) queue.push(id);
  });

  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    topoOrder.push(cur);
    for (const edge of dependents[cur] || []) {
      inDegree[edge.taskId] -= 1;
      if (inDegree[edge.taskId] === 0) queue.push(edge.taskId);
    }
  }

  const shifted: CascadeShiftPreviewItem[] = [];

  for (const tid of topoOrder) {
    if (tid === triggerTaskId) continue;
    const t = workingCopy[tid];
    // Jamais décalées: démarrée, terminée, annulée, ou tâche parente
    const hasChildren = allTasks.some((other) => other.parentId === tid);
    if (hasChildren || t.status !== 'a_faire') continue;

    const sched = resolveScheduleForTask(t, project, schedules);
    const decalerPreds = t.dependencies.filter((dep) => {
      const pred = workingCopy[dep.predecessorId];
      if (!pred || pred.status === 'annulee') return false;
      const effReaction =
        dep.predecessorId === triggerTaskId && overrideReactions[tid]
          ? overrideReactions[tid]
          : dep.reaction;
      return effReaction === 'decaler';
    });

    if (decalerPreds.length === 0) continue;

    let earliestStart = '';
    for (const dep of decalerPreds) {
      const predEnd = effectiveEnd[dep.predecessorId];
      const candidate = nextWorkedDayStrictlyAfter(predEnd, sched, holidays);
      if (!earliestStart || candidate > earliestStart) {
        earliestStart = candidate;
      }
    }

    if (earliestStart && t.startDate < earliestStart) {
      const dur = Math.max(1, countWorkedDays(t.startDate, t.endDate, sched, holidays));
      const newEnd = nthWorkedDayFrom(earliestStart, dur, sched, holidays);
      effectiveEnd[tid] = newEnd;
      shifted.push({
        taskId: tid,
        code: t.code,
        title: t.title,
        oldStartDate: t.startDate,
        oldEndDate: t.endDate,
        newStartDate: earliestStart,
        newEndDate: newEnd,
        durationWorked: dur,
        scheduleName: sched.name,
      });
    }
  }

  return shifted;
}
