import express, { type Response } from 'express';
import {
  computeCascadeShiftPreview,
  computeLeafTaskMetrics,
  countWorkedDays,
  getCasablancaTodayISO,
  nextWorkedDayOnOrAfter,
  nthWorkedDayFrom,
  resolveScheduleForTask,
  signedVarianceDays,
  wouldCreateCycle,
} from '../src/shared/calculationEngine.ts';
import type {
  BudgetRevision,
  InvoiceRecord,
  Priority,
  ProjectTask,
  PurchaseOrder,
  Supplier,
  SupplierStatus,
  TaskDependency,
  TaskExecutionMode,
} from '../src/shared/types.ts';
import { evaluateAllAlerts } from './alertsEngine.ts';
import {
  type AuthedReq,
  bumpPlanningRevision,
  denyAdminContent,
  tryAutoAdvancePlanningToControl,
} from './routesProjects.ts';
import {
  canActAsRole,
  cleanString,
  makeId,
  recordBusinessHistory,
  saveStore,
  store,
} from './store.ts';

function nextTaskCode(projectId: string, parentId: string | null): { code: string; level: 1 | 2 | 3 } {
  const siblings = store.tasks.filter((t) => t.projectId === projectId && t.parentId === parentId);
  if (!parentId) {
    const maxN = siblings.reduce((m, t) => Math.max(m, parseInt(t.code, 10) || 0), 0);
    return { code: String(maxN + 1), level: 1 };
  }
  const parent = store.tasks.find((t) => t.id === parentId);
  const parentLevel = parent?.level || 1;
  const level = (parentLevel === 1 ? 2 : 3) as 2 | 3;
  const maxSub = siblings.reduce((m, t) => {
    const seg = parseInt(t.code.split('.').pop() || '0', 10) || 0;
    return Math.max(m, seg);
  }, 0);
  return { code: `${parent?.code || '1'}.${maxSub + 1}`, level };
}

export function createTasksAndBudgetRouter(
  requireAuth: express.RequestHandler,
  broadcastSync: () => void
): express.Router {
  const router = express.Router();

  // -------------------------------------------------------------------------
  // M2: Tasks & Dependencies
  // -------------------------------------------------------------------------
  router.post('/projects/:projectId/tasks', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const project = store.projects.find((p) => p.id === req.params.projectId);
    if (!project || project.status === 'clos' || project.status === 'annule') {
      res.status(404).json({ error: 'Projet introuvable ou fermé.' });
      return;
    }

    const expectedRev = req.body?.expectedPlanningRevision;
    if (typeof expectedRev === 'number' && expectedRev !== project.planningRevision) {
      res.status(409).json({
        error: `Le planning a été modifié par un collaborateur ; rechargez avant d'enregistrer (révision ${project.planningRevision}).`,
      });
      return;
    }

    const planningPh = project.phases.find((p) => p.key === 'planning');
    const isPlanningLead = planningPh?.stakeholders.some((s) => s.uid === actor.uid && s.isLead);
    if (project.responsable0Id !== actor.uid && !isPlanningLead && actor.role !== 'directeur') {
      res.status(403).json({ error: 'Seul le Responsable 0 ou le pilote Planification peut créer des tâches.' });
      return;
    }

    const parentId = cleanString(req.body?.parentId || '', 80) || null;
    if (parentId) {
      const parent = store.tasks.find((t) => t.id === parentId && t.projectId === project.id);
      if (!parent || parent.level >= 3) {
        res.status(400).json({ error: 'Hiérarchie limitée à 3 niveaux maximum (1 / 1.1 / 1.1.1).' });
        return;
      }
      if (parent.status === 'annulee') {
        res.status(400).json({ error: 'Impossible d’ajouter une sous-tâche à une tâche annulée.' });
        return;
      }
    }

    const title = cleanString(req.body?.title, 160);
    const startDate = cleanString(req.body?.startDate, 10);
    const endDate = cleanString(req.body?.endDate, 10);
    const assigneeId = cleanString(req.body?.assigneeId, 80);
    if (!title || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(startDate) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(endDate) || endDate < startDate) {
      res.status(400).json({ error: 'Titre et dates valides obligatoires.' });
      return;
    }

    const assignee = store.users.find((u) => u.uid === assigneeId && u.status === 'actif');
    if (!assignee) {
      res.status(400).json({ error: 'Intervenant introuvable ou inactif.' });
      return;
    }

    const executionMode: TaskExecutionMode = req.body?.executionMode === 'externe' ? 'externe' : 'interne';
    let supplierId = cleanString(req.body?.supplierId || '', 80) || undefined;
    let supplierName: string | undefined;
    let supplierPendingApproval = false;

    if (executionMode === 'externe') {
      if (req.body?.proposeSupplier && typeof req.body.proposeSupplier === 'object') {
        const ps = req.body.proposeSupplier;
        const sName = cleanString(ps.name, 120);
        const sIce = cleanString(ps.ice, 30);
        if (!sName || !sIce) {
          res.status(400).json({ error: 'Nom et ICE du prestataire proposé obligatoires.' });
          return;
        }
        const existingIce = store.suppliers.find((s) => s.ice.toLowerCase() === sIce.toLowerCase());
        if (existingIce) {
          supplierId = existingIce.id;
          supplierName = existingIce.name;
          supplierPendingApproval = existingIce.status === 'a_verifier';
        } else {
          const newSup: Supplier = {
            id: makeId('sup'),
            name: sName,
            ice: sIce,
            domain: cleanString(ps.domain || 'Prestation externe', 100),
            contactName: cleanString(ps.contactName || '', 100),
            contactPhone: cleanString(ps.contactPhone || '', 40),
            contactEmail: cleanString(ps.contactEmail || '', 120),
            status: actor.role === 'responsable_achat' || actor.role === 'directeur' ? 'qualifie' : 'a_verifier',
            proposedById: actor.uid,
            proposedByName: actor.displayName,
            createdAt: new Date().toISOString(),
          };
          store.suppliers.unshift(newSup);
          supplierId = newSup.id;
          supplierName = newSup.name;
          supplierPendingApproval = newSup.status === 'a_verifier';
        }
      } else if (supplierId) {
        const sup = store.suppliers.find((s) => s.id === supplierId);
        if (sup) {
          if (sup.status === 'inactif') {
            res.status(400).json({ error: 'Impossible d’assigner un prestataire inactif.' });
            return;
          }
          supplierName = sup.name;
          supplierPendingApproval = sup.status === 'a_verifier';
        }
      }
      if (supplierId && !project.attachedSupplierIds.includes(supplierId)) {
        project.attachedSupplierIds.push(supplierId);
      }
    }

    const projectTasks = store.tasks.filter((t) => t.projectId === project.id);
    const depsInput: TaskDependency[] = Array.isArray(req.body?.dependencies)
      ? req.body.dependencies.filter((d: TaskDependency) => d && typeof d.predecessorId === 'string')
      : [];

    const { code, level } = nextTaskCode(project.id, parentId);
    const now = new Date().toISOString();
    const isMigrationDone =
      Boolean(req.body?.isMigrationCompleted) &&
      Boolean(project.migration?.isMigrated) &&
      !project.planningLaunched;

    const rawCoPilots: string[] = Array.isArray(req.body?.coPilotIds) ? req.body.coPilotIds : [];
    const coPilotUsers = rawCoPilots
      .filter((id, idx) => id && id !== assignee.uid && rawCoPilots.indexOf(id) === idx)
      .map((id) => store.users.find((u) => u.uid === id && u.status === 'actif' && u.role !== 'administrateur'))
      .filter((u): u is NonNullable<typeof u> => Boolean(u));

    const newTask: ProjectTask = {
      id: makeId('tsk'),
      projectId: project.id,
      parentId,
      level,
      code,
      title,
      description: cleanString(req.body?.description || '', 1000),
      priority: (req.body?.priority as Priority) || 'moyenne',
      startDate,
      endDate,
      workScheduleId: cleanString(req.body?.workScheduleId || '', 80) || undefined,
      executionMode,
      departmentId: assignee.departmentId,
      departmentName: assignee.departmentName,
      assigneeId: assignee.uid,
      assigneeName: assignee.displayName,
      coPilotIds: coPilotUsers.length > 0 ? coPilotUsers.map((u) => u.uid) : undefined,
      coPilotNames: coPilotUsers.length > 0 ? coPilotUsers.map((u) => u.displayName) : undefined,
      supplierId,
      supplierName,
      supplierPendingApproval: supplierPendingApproval || undefined,
      dependencies: depsInput,
      progress: isMigrationDone ? 100 : 0,
      status: isMigrationDone ? 'terminee' : 'a_faire',
      actualStartDate: isMigrationDone ? startDate : undefined,
      actualEndDate: isMigrationDone ? endDate : undefined,
      isMigration: isMigrationDone || undefined,
      frozenEr: isMigrationDone ? 0 : undefined,
      frozenErRef: isMigrationDone ? 0 : undefined,
      createdBy: actor.uid,
      createdAt: now,
      updatedAt: now,
    };

    // Cycle check
    const tempAll = [...projectTasks, newTask];
    for (const d of depsInput) {
      if (wouldCreateCycle(tempAll, d.predecessorId, newTask.id)) {
        res.status(409).json({ error: 'Dépendance circulaire détectée et refusée.' });
        return;
      }
    }

    store.tasks.push(newTask);
    bumpPlanningRevision(project, actor, `Création tâche ${newTask.code}`);

    recordBusinessHistory({
      projectId: project.id,
      entityType: 'task',
      entityId: newTask.id,
      actor,
      action: `Création tâche ${newTask.code}`,
      afterValue: `${newTask.title} (${startDate} → ${endDate})`,
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.status(201).json({ task: newTask, project });
  });

  router.patch('/projects/:projectId/tasks/:taskId', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const project = store.projects.find((p) => p.id === req.params.projectId);
    const task = store.tasks.find((t) => t.id === req.params.taskId && t.projectId === req.params.projectId);
    if (!project || !task) {
      res.status(404).json({ error: 'Projet ou tâche introuvable.' });
      return;
    }

    const expectedRev = req.body?.expectedPlanningRevision;
    if (typeof expectedRev === 'number' && expectedRev !== project.planningRevision) {
      res.status(409).json({
        error: `Le planning a été modifié entre-temps ; rechargez avant d'enregistrer (révision ${project.planningRevision}).`,
      });
      return;
    }

    const planningPh = project.phases.find((p) => p.key === 'planning');
    const isPlanningLead = planningPh?.stakeholders.some((s) => s.uid === actor.uid && s.isLead);
    if (project.responsable0Id !== actor.uid && !isPlanningLead && actor.role !== 'directeur') {
      res.status(403).json({ error: 'Seul le Responsable 0 ou le pilote Planification peut modifier la structure.' });
      return;
    }

    const projectTasks = store.tasks.filter((t) => t.projectId === project.id);

    if (Array.isArray(req.body?.dependencies)) {
      const deps: TaskDependency[] = req.body.dependencies;
      for (const d of deps) {
        if (wouldCreateCycle(projectTasks, d.predecessorId, task.id)) {
          res.status(409).json({ error: 'Dépendance circulaire détectée et refusée.' });
          return;
        }
      }
      task.dependencies = deps;
    }

    if (typeof req.body?.title === 'string' && req.body.title.trim()) {
      task.title = cleanString(req.body.title, 160);
    }
    if (typeof req.body?.description === 'string') {
      task.description = cleanString(req.body.description, 1000);
    }
    if (typeof req.body?.priority === 'string') {
      task.priority = req.body.priority as Priority;
    }
    if (typeof req.body?.startDate === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(req.body.startDate)) {
      task.startDate = req.body.startDate;
    }
    if (typeof req.body?.endDate === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(req.body.endDate)) {
      if (req.body.endDate < task.startDate) {
        res.status(400).json({ error: 'La date de fin ne peut pas précéder la date de début.' });
        return;
      }
      task.endDate = req.body.endDate;
    }
    if (typeof req.body?.assigneeId === 'string' && req.body.assigneeId) {
      const u = store.users.find((x) => x.uid === req.body.assigneeId && x.status === 'actif');
      if (u) {
        task.assigneeId = u.uid;
        task.assigneeName = u.displayName;
        task.departmentId = u.departmentId;
        task.departmentName = u.departmentName;
      }
    }
    if (Array.isArray(req.body?.coPilotIds)) {
      const rawCoPilots: string[] = req.body.coPilotIds;
      const coPilotUsers = rawCoPilots
        .filter((id, idx) => id && id !== task.assigneeId && rawCoPilots.indexOf(id) === idx)
        .map((id) => store.users.find((x) => x.uid === id && x.status === 'actif' && x.role !== 'administrateur'))
        .filter((u): u is NonNullable<typeof u> => Boolean(u));
      task.coPilotIds = coPilotUsers.length > 0 ? coPilotUsers.map((u) => u.uid) : undefined;
      task.coPilotNames = coPilotUsers.length > 0 ? coPilotUsers.map((u) => u.displayName) : undefined;
    } else if (task.coPilotIds?.includes(task.assigneeId)) {
      const remaining = task.coPilotIds
        .filter((id) => id !== task.assigneeId)
        .map((id) => store.users.find((x) => x.uid === id))
        .filter((u): u is NonNullable<typeof u> => Boolean(u));
      task.coPilotIds = remaining.length > 0 ? remaining.map((u) => u.uid) : undefined;
      task.coPilotNames = remaining.length > 0 ? remaining.map((u) => u.displayName) : undefined;
    }
    if (req.body?.executionMode === 'interne' || req.body?.executionMode === 'externe') {
      task.executionMode = req.body.executionMode;
      if (task.executionMode === 'interne') {
        task.supplierId = undefined;
        task.supplierName = undefined;
        task.supplierPendingApproval = false;
      }
    }
    if (typeof req.body?.supplierId === 'string' && task.executionMode === 'externe') {
      const sup = store.suppliers.find((s) => s.id === req.body.supplierId);
      if (sup && sup.status !== 'inactif') {
        task.supplierId = sup.id;
        task.supplierName = sup.name;
        task.supplierPendingApproval = sup.status === 'a_verifier';
      }
    }
    if (req.body?.workScheduleId !== undefined) {
      task.workScheduleId = cleanString(req.body.workScheduleId || '', 80) || undefined;
    }

    task.calendarConflict = undefined;
    task.updatedAt = new Date().toISOString();
    bumpPlanningRevision(project, actor, `Modification tâche ${task.code}`);

    recordBusinessHistory({
      projectId: project.id,
      entityType: 'task',
      entityId: task.id,
      actor,
      action: `Modification tâche ${task.code}`,
      afterValue: `${task.startDate} → ${task.endDate}`,
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ task, project });
  });

  // Cascade Delay Apply (§4.8)
  router.post('/projects/:projectId/tasks/:taskId/apply-cascade', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const project = store.projects.find((p) => p.id === req.params.projectId);
    const triggerTask = store.tasks.find((t) => t.id === req.params.taskId && t.projectId === req.params.projectId);
    if (!project || !triggerTask) {
      res.status(404).json({ error: 'Projet ou tâche introuvable.' });
      return;
    }

    const newEndDate = cleanString(req.body?.newEndDate || triggerTask.endDate, 10);
    const overrideReactions = (req.body?.overrideReactions || {}) as Record<string, 'sans_impact' | 'decaler'>;
    const projectTasks = store.tasks.filter((t) => t.projectId === project.id);

    // Apply overrides to direct dependents
    for (const t of projectTasks) {
      const dep = t.dependencies.find((d) => d.predecessorId === triggerTask.id);
      if (dep && overrideReactions[t.id]) {
        dep.reaction = overrideReactions[t.id];
      }
    }

    const shifted = computeCascadeShiftPreview(
      triggerTask.id,
      newEndDate,
      overrideReactions,
      project,
      projectTasks,
      store.workSchedules,
      store.holidays
    );

    if (newEndDate > triggerTask.endDate && triggerTask.status !== 'terminee') {
      triggerTask.endDate = newEndDate;
    }
    const now = new Date().toISOString();
    for (const s of shifted) {
      const target = store.tasks.find((t) => t.id === s.taskId);
      if (target) {
        target.startDate = s.newStartDate;
        target.endDate = s.newEndDate;
        target.updatedAt = now;
      }
    }

    bumpPlanningRevision(project, actor, `Cascade retard depuis ${triggerTask.code}`);
    recordBusinessHistory({
      projectId: project.id,
      entityType: 'cascade',
      entityId: triggerTask.id,
      actor,
      action: `Propagation de retard (${triggerTask.code})`,
      afterValue: `${shifted.length} tâche(s) décalée(s)`,
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ shifted, project });
  });

  // Resolve Calendar Conflict
  router.post('/projects/:projectId/tasks/:taskId/resolve-calendar-conflict', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const project = store.projects.find((p) => p.id === req.params.projectId);
    const task = store.tasks.find((t) => t.id === req.params.taskId && t.projectId === req.params.projectId);
    if (!project || !task) {
      res.status(404).json({ error: 'Projet ou tâche introuvable.' });
      return;
    }

    const mode = req.body?.mode === 'shift' ? 'shift' : 'keep';
    if (mode === 'shift') {
      const sched = resolveScheduleForTask(task, project, store.workSchedules);
      const dur = Math.max(1, countWorkedDays(task.startDate, task.endDate, sched, store.holidays));
      const newStart = nextWorkedDayOnOrAfter(task.startDate, sched, store.holidays);
      const newEnd = nthWorkedDayFrom(newStart, dur, sched, store.holidays);
      task.startDate = newStart;
      task.endDate = newEnd;
      bumpPlanningRevision(project, actor, `Résolution conflit calendrier (${task.code})`);
    }
    task.calendarConflict = undefined;
    task.updatedAt = new Date().toISOString();

    recordBusinessHistory({
      projectId: project.id,
      entityType: 'task',
      entityId: task.id,
      actor,
      action: mode === 'shift' ? `Décalage suite conflit calendrier (${task.code})` : `Dates conservées malgré conflit calendrier (${task.code})`,
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ task, project });
  });

  // Task Execution Actions (Démarrer, Avancement 5%, En attente, Clôturer R16, Réouvrir, Annuler)
  router.post('/projects/:projectId/tasks/:taskId/action', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const project = store.projects.find((p) => p.id === req.params.projectId);
    const task = store.tasks.find((t) => t.id === req.params.taskId && t.projectId === req.params.projectId);
    if (!project || !task) {
      res.status(404).json({ error: 'Projet ou tâche introuvable.' });
      return;
    }
    if (project.status === 'suspendu' || project.status === 'clos' || project.status === 'annule') {
      res.status(400).json({ error: `Action bloquée : le projet est ${project.status}.` });
      return;
    }

    const projectTasks = store.tasks.filter((t) => t.projectId === project.id);
    if (projectTasks.some((t) => t.parentId === task.id)) {
      res.status(400).json({ error: 'Les tâches parentes agrègent automatiquement leurs sous-tâches.' });
      return;
    }

    const planningPh = project.phases.find((p) => p.key === 'planning');
    const isPlanningLead = planningPh?.stakeholders.some((s) => s.uid === actor.uid && s.isLead);
    const isR0 = project.responsable0Id === actor.uid;
    const isAssignee =
      task.assigneeId === actor.uid || Boolean(task.coPilotIds?.includes(actor.uid));

    const action = req.body?.action as string;
    const now = new Date().toISOString();

    if (action === 'start') {
      if (!isAssignee && !isR0 && !isPlanningLead) {
        res.status(403).json({ error: 'Seul l’intervenant assigné ou le Responsable peut démarrer cette tâche.' });
        return;
      }
      if (!project.planningLaunched) {
        res.status(409).json({ error: 'Verrouillée : le planning du projet doit d’abord être lancé.' });
        return;
      }
      for (const dep of task.dependencies) {
        const pred = projectTasks.find((t) => t.id === dep.predecessorId);
        if (pred && pred.status !== 'terminee' && pred.status !== 'annulee') {
          res.status(409).json({ error: `Verrouillée par le prédécesseur ${pred.code} (« ${pred.title} »).` });
          return;
        }
      }
      if (task.status !== 'a_faire' && task.status !== 'en_attente') {
        res.status(400).json({ error: 'Tâche déjà en cours ou terminée.' });
        return;
      }
      task.status = 'en_cours';
      if (!task.actualStartDate) task.actualStartDate = todayISO;
      task.waitReason = undefined;
    } else if (action === 'progress') {
      if (!isAssignee && !isR0 && !isPlanningLead) {
        res.status(403).json({ error: 'Permission refusée.' });
        return;
      }
      const p = Number(req.body?.progress);
      if (Number.isNaN(p) || p < 0 || p > 95 || p % 5 !== 0) {
        res.status(400).json({ error: 'L’avancement doit être un multiple de 5% entre 0% et 95% (utilisez Clôturer pour 100%).' });
        return;
      }
      if (task.status === 'a_faire') {
        if (!project.planningLaunched) {
          res.status(409).json({ error: 'Lancez le planning avant de saisir un avancement.' });
          return;
        }
        task.status = 'en_cours';
        task.actualStartDate = task.actualStartDate || todayISO;
      }
      task.progress = p;
      task.waitReason = undefined;
    } else if (action === 'wait') {
      if (!isAssignee && !isR0 && !isPlanningLead) {
        res.status(403).json({ error: 'Permission refusée.' });
        return;
      }
      const reason = cleanString(req.body?.reason || '', 500);
      if (!reason) {
        res.status(400).json({ error: 'Un motif de mise en attente est obligatoire.' });
        return;
      }
      task.status = 'en_attente';
      task.waitReason = reason;
    } else if (action === 'complete') {
      if (!isAssignee && !isR0 && !isPlanningLead) {
        res.status(403).json({ error: 'Permission refusée.' });
        return;
      }
      if (!project.planningLaunched) {
        res.status(409).json({ error: 'Le planning doit être lancé avant la clôture d’une tâche.' });
        return;
      }
      const sched = resolveScheduleForTask(task, project, store.workSchedules);
      const er = signedVarianceDays(todayISO, task.endDate, sched, store.holidays);
      const erRef = signedVarianceDays(todayISO, task.refEndDate || task.endDate, sched, store.holidays);
      const justification = cleanString(req.body?.delayJustification || '', 1000);
      if (er < 0 && justification.length < 20) {
        res.status(400).json({
          error: `Clôture avec retard (${er} j) : une justification d’au moins 20 caractères est obligatoire.`,
        });
        return;
      }
      task.status = 'terminee';
      task.progress = 100;
      task.actualStartDate = task.actualStartDate || todayISO;
      task.actualEndDate = todayISO;
      task.frozenEr = er;
      task.frozenErRef = erRef;
      task.delayJustification = justification || undefined;
      task.controlStatus = 'en_attente';
      void computeLeafTaskMetrics;
    } else if (action === 'reopen') {
      if (!isR0 && !isPlanningLead && actor.role !== 'directeur') {
        res.status(403).json({ error: 'Seul le Responsable 0 ou le pilote Planification peut réouvrir une tâche.' });
        return;
      }
      task.status = 'en_cours';
      task.progress = 95;
      task.actualEndDate = undefined;
      task.frozenEr = null;
      task.frozenErRef = null;
      task.controlStatus = undefined;
    } else if (action === 'cancel') {
      if (!isR0 && !isPlanningLead && actor.role !== 'directeur') {
        res.status(403).json({ error: 'Seul le Responsable 0 ou le pilote Planification peut annuler une tâche.' });
        return;
      }
      const reason = cleanString(req.body?.reason || '', 500);
      if (!reason) {
        res.status(400).json({ error: 'Un motif d’annulation est obligatoire.' });
        return;
      }
      task.status = 'annulee';
      task.progress = 0;
      task.cancelReason = reason;
    } else {
      res.status(400).json({ error: 'Action tâche inconnue.' });
      return;
    }

    task.updatedAt = now;
    recordBusinessHistory({
      projectId: project.id,
      entityType: 'task',
      entityId: task.id,
      actor,
      action: `Tâche ${task.code} : ${action}`,
      afterValue: `${task.status} (${task.progress}%)`,
      reason: req.body?.reason || req.body?.delayJustification,
    });

    tryAutoAdvancePlanningToControl(project, actor);
    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ task, project });
  });

  // -------------------------------------------------------------------------
  // M5: Suppliers Directory & Proposals
  // -------------------------------------------------------------------------
  router.get('/suppliers', requireAuth, denyAdminContent, (_req: AuthedReq, res: Response) => {
    res.json({ suppliers: store.suppliers });
  });

  router.post('/suppliers', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const name = cleanString(req.body?.name, 140);
    const ice = cleanString(req.body?.ice, 30);
    const domain = cleanString(req.body?.domain, 120);
    if (!name || !ice) {
      res.status(400).json({ error: 'Raison sociale et ICE obligatoires.' });
      return;
    }
    if (store.suppliers.some((s) => s.ice.toLowerCase() === ice.toLowerCase())) {
      res.status(409).json({ error: `Un prestataire avec l’ICE ${ice} existe déjà.` });
      return;
    }
    const isRA = canActAsRole(actor, 'responsable_achat', 'create_supplier', todayISO).allowed;
    const isDir = canActAsRole(actor, 'directeur', 'create_supplier', todayISO).allowed;
    const sup: Supplier = {
      id: makeId('sup'),
      name,
      ice,
      domain: domain || 'Prestations techniques',
      contactName: cleanString(req.body?.contactName || '', 100),
      contactPhone: cleanString(req.body?.contactPhone || '', 40),
      contactEmail: cleanString(req.body?.contactEmail || '', 120),
      status: isRA || isDir ? 'qualifie' : 'a_verifier',
      proposedById: isRA || isDir ? undefined : actor.uid,
      proposedByName: isRA || isDir ? undefined : actor.displayName,
      createdAt: new Date().toISOString(),
    };
    store.suppliers.unshift(sup);
    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.status(201).json({ supplier: sup });
  });

  router.patch('/suppliers/:id', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const isRA = canActAsRole(actor, 'responsable_achat', 'manage_supplier', todayISO).allowed;
    const isDir = canActAsRole(actor, 'directeur', 'manage_supplier', todayISO).allowed;
    if (!isRA && !isDir) {
      res.status(403).json({ error: 'Seul le Responsable achat ou la Direction peut qualifier/désactiver un prestataire.' });
      return;
    }

    const sup = store.suppliers.find((s) => s.id === req.params.id);
    if (!sup) {
      res.status(404).json({ error: 'Prestataire introuvable.' });
      return;
    }

    const nextStatus = req.body?.status as SupplierStatus | undefined;
    if (nextStatus === 'inactif') {
      const usedOnActiveTask = store.tasks.some(
        (t) => t.supplierId === sup.id && t.status !== 'terminee' && t.status !== 'annulee'
      );
      if (usedOnActiveTask) {
        res.status(409).json({
          error: 'Désactivation refusée : ce prestataire est affecté à des tâches non terminées.',
        });
        return;
      }
    }

    if (typeof req.body?.name === 'string' && req.body.name.trim()) sup.name = cleanString(req.body.name, 140);
    if (typeof req.body?.domain === 'string') sup.domain = cleanString(req.body.domain, 120);
    if (typeof req.body?.contactName === 'string') sup.contactName = cleanString(req.body.contactName, 100);
    if (typeof req.body?.contactPhone === 'string') sup.contactPhone = cleanString(req.body.contactPhone, 40);
    if (typeof req.body?.contactEmail === 'string') sup.contactEmail = cleanString(req.body.contactEmail, 120);
    if (nextStatus && ['qualifie', 'a_verifier', 'inactif'].includes(nextStatus)) {
      sup.status = nextStatus;
      // Sync tasks/interventions using this supplier
      for (const t of store.tasks) {
        if (t.supplierId === sup.id) {
          t.supplierName = sup.name;
          t.supplierPendingApproval = sup.status === 'a_verifier' ? true : undefined;
        }
      }
      for (const i of store.interventions) {
        if (i.supplierId === sup.id) {
          i.supplierName = sup.name;
          i.supplierPendingApproval = sup.status === 'a_verifier' ? true : undefined;
        }
      }
    }

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ supplier: sup });
  });

  // -------------------------------------------------------------------------
  // M5: Budget Revisions, Purchase Orders & Invoices
  // -------------------------------------------------------------------------
  router.post('/projects/:projectId/budget-revisions', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const isRA = canActAsRole(actor, 'responsable_achat', 'budget_create', todayISO);
    const isDir = canActAsRole(actor, 'directeur', 'budget_create', todayISO);
    if (!isRA.allowed && !isDir.allowed) {
      res.status(403).json({ error: 'Seul le Responsable achat ou la Direction peut saisir un budget.' });
      return;
    }
    const project = store.projects.find((p) => p.id === req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Projet introuvable.' });
      return;
    }

    const linesInput = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (linesInput.length === 0) {
      res.status(400).json({ error: 'Au moins une ligne budgétaire est requise.' });
      return;
    }
    const submit = Boolean(req.body?.submit);
    const existingCount = store.budgetRevisions.filter((b) => b.projectId === project.id).length;
    const rev: BudgetRevision = {
      id: makeId('brev'),
      projectId: project.id,
      version: existingCount + 1,
      status: submit ? 'soumise' : 'brouillon',
      reason: cleanString(req.body?.reason || 'Étude budgétaire', 400),
      lines: linesInput.map((l: { id?: string; category?: string; designation?: string; plannedAmount?: number; settled?: boolean }) => ({
        id: l.id || makeId('bl'),
        category: cleanString(l.category || 'Général', 80),
        designation: cleanString(l.designation || 'Ligne budgétaire', 160),
        plannedAmount: Math.max(0, Number(l.plannedAmount) || 0),
        settled: Boolean(l.settled),
      })),
      requestedById: actor.uid,
      requestedByName: actor.displayName,
      requestedAt: new Date().toISOString(),
      byDelegationOf: isRA.delegation?.delegatorName || isDir.delegation?.delegatorName,
    };

    store.budgetRevisions.unshift(rev);
    recordBusinessHistory({
      projectId: project.id,
      entityType: 'budget',
      entityId: rev.id,
      actor,
      action: submit ? `Soumission budget V${rev.version}` : `Brouillon budget V${rev.version}`,
      reason: rev.reason,
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.status(201).json({ budgetRevision: rev });
  });

  router.post('/projects/:projectId/budget-revisions/:revId/decide', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const isDir = canActAsRole(actor, 'directeur', 'budget_decide', todayISO);
    if (!isDir.allowed) {
      res.status(403).json({ error: 'Seule la Direction peut valider ou rejeter une révision budgétaire.' });
      return;
    }
    const project = store.projects.find((p) => p.id === req.params.projectId);
    const rev = store.budgetRevisions.find((b) => b.id === req.params.revId && b.projectId === req.params.projectId);
    if (!project || !rev) {
      res.status(404).json({ error: 'Révision introuvable.' });
      return;
    }

    const decision = req.body?.decision as 'validee' | 'a_revoir' | 'rejetee';
    const comment = cleanString(req.body?.comment || '', 500);
    if (!['validee', 'a_revoir', 'rejetee'].includes(decision)) {
      res.status(400).json({ error: 'Décision budgétaire invalide.' });
      return;
    }

    const now = new Date().toISOString();
    if (decision === 'validee') {
      for (const prev of store.budgetRevisions) {
        if (prev.projectId === project.id && prev.status === 'validee') {
          prev.status = 'remplacee';
        }
      }
      project.budgetRevision = rev.version;
    }
    rev.status = decision;
    rev.decidedById = actor.uid;
    rev.decidedByName = actor.displayName;
    rev.decidedAt = now;
    rev.decisionComment = comment || undefined;
    rev.byDelegationOf = isDir.delegation?.delegatorName;

    recordBusinessHistory({
      projectId: project.id,
      entityType: 'budget',
      entityId: rev.id,
      actor,
      onBehalfOf: isDir.delegation?.delegatorName,
      action: `Décision budget V${rev.version} : ${decision}`,
      reason: comment,
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ budgetRevision: rev, project });
  });

  router.post('/projects/:projectId/purchase-orders', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const isRA = canActAsRole(actor, 'responsable_achat', 'create_po', todayISO);
    const isDir = canActAsRole(actor, 'directeur', 'create_po', todayISO);
    if (!isRA.allowed && !isDir.allowed) {
      res.status(403).json({ error: 'Seul le Responsable achat ou la Direction peut créer un bon de commande.' });
      return;
    }
    const project = store.projects.find((p) => p.id === req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Projet introuvable.' });
      return;
    }

    const number = cleanString(req.body?.number, 60);
    const issueDate = cleanString(req.body?.issueDate || todayISO, 10);
    const budgetLineId = cleanString(req.body?.budgetLineId, 80);
    const supplierId = cleanString(req.body?.supplierId, 80);
    const attachmentId = cleanString(req.body?.attachmentId, 80);
    const amountHT = Number(req.body?.amountHT);
    const vatRate = Number(req.body?.vatRate) as 0 | 7 | 10 | 14 | 20;

    if (!number || !budgetLineId || !supplierId || !attachmentId || Number.isNaN(amountHT) || amountHT <= 0) {
      res.status(400).json({ error: 'Numéro, ligne budgétaire, prestataire, montant HT > 0 et scan du bon sont obligatoires.' });
      return;
    }
    if (![0, 7, 10, 14, 20].includes(vatRate)) {
      res.status(400).json({ error: 'Taux de TVA autorisés : 0%, 7%, 10%, 14%, 20%.' });
      return;
    }
    const sup = store.suppliers.find((s) => s.id === supplierId);
    if (!sup) {
      res.status(400).json({ error: 'Prestataire introuvable.' });
      return;
    }

    const vatAmount = Math.round(amountHT * vatRate) / 100;
    const amountTTC = Math.round((amountHT + vatAmount) * 100) / 100;

    const po: PurchaseOrder = {
      id: makeId('po'),
      projectId: project.id,
      budgetLineId,
      number,
      issueDate,
      supplierId: sup.id,
      supplierName: sup.name,
      amountHT,
      vatRate,
      vatAmount,
      amountTTC,
      currency: project.currency,
      attachmentId,
      status: 'actif',
      exceedReason: cleanString(req.body?.exceedReason || '', 400) || undefined,
      createdById: actor.uid,
      createdByName: actor.displayName,
      createdAt: new Date().toISOString(),
    };

    store.purchaseOrders.unshift(po);
    recordBusinessHistory({
      projectId: project.id,
      entityType: 'order',
      entityId: po.id,
      actor,
      action: `Émission bon de commande ${po.number}`,
      afterValue: `${po.amountHT.toFixed(2)} ${project.currency} HT`,
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.status(201).json({ purchaseOrder: po });
  });

  router.post('/projects/:projectId/purchase-orders/:poId/cancel', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const isRA = canActAsRole(actor, 'responsable_achat', 'cancel_po', todayISO);
    const isDir = canActAsRole(actor, 'directeur', 'cancel_po', todayISO);
    if (!isRA.allowed && !isDir.allowed) {
      res.status(403).json({ error: 'Permission refusée pour annuler ce bon de commande.' });
      return;
    }
    const po = store.purchaseOrders.find((p) => p.id === req.params.poId && p.projectId === req.params.projectId);
    if (!po || po.status === 'annule') {
      res.status(404).json({ error: 'Bon de commande introuvable ou déjà annulé.' });
      return;
    }
    const reason = cleanString(req.body?.reason || '', 500);
    if (!reason) {
      res.status(400).json({ error: 'Un motif d’annulation est obligatoire.' });
      return;
    }
    po.status = 'annule';
    po.cancelReason = reason;

    recordBusinessHistory({
      projectId: po.projectId,
      entityType: 'order',
      entityId: po.id,
      actor,
      action: `Annulation bon de commande ${po.number}`,
      reason,
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ purchaseOrder: po });
  });

  router.post('/projects/:projectId/invoices', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const isRA = canActAsRole(actor, 'responsable_achat', 'create_invoice', todayISO);
    const isDir = canActAsRole(actor, 'directeur', 'create_invoice', todayISO);
    if (!isRA.allowed && !isDir.allowed) {
      res.status(403).json({ error: 'Seul le Responsable achat ou la Direction peut saisir une facture/avoir.' });
      return;
    }
    const project = store.projects.find((p) => p.id === req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Projet introuvable.' });
      return;
    }

    const orderId = cleanString(req.body?.orderId, 80);
    const po = store.purchaseOrders.find((p) => p.id === orderId && p.projectId === project.id);
    if (!po) {
      res.status(400).json({ error: 'Bon de commande rattaché introuvable.' });
      return;
    }
    const type = req.body?.type === 'avoir' ? 'avoir' : 'facture';
    const number = cleanString(req.body?.number, 60);
    const issueDate = cleanString(req.body?.issueDate || todayISO, 10);
    const originalCurrency = cleanString(req.body?.originalCurrency || project.currency, 8).toUpperCase();
    const rawAmountHT = Number(req.body?.originalAmountHT);
    const exchangeRate = Number(req.body?.exchangeRate) || 1;
    const attachmentId = cleanString(req.body?.attachmentId, 80);

    if (!number || !attachmentId || Number.isNaN(rawAmountHT) || rawAmountHT === 0) {
      res.status(400).json({ error: 'Numéro, montant HT et justificatif scanné obligatoires.' });
      return;
    }

    const signedOriginalHT = type === 'avoir' ? -Math.abs(rawAmountHT) : Math.abs(rawAmountHT);
    const convertedAmountHT = Math.round(signedOriginalHT * exchangeRate * 100) / 100;
    const vatAmount = Math.round((convertedAmountHT * po.vatRate) / 100 * 100) / 100;
    const amountTTC = Math.round((convertedAmountHT + vatAmount) * 100) / 100;

    const inv: InvoiceRecord = {
      id: makeId('inv'),
      projectId: project.id,
      orderId: po.id,
      budgetLineId: po.budgetLineId,
      type,
      number,
      issueDate,
      originalCurrency,
      originalAmountHT: signedOriginalHT,
      vatAmount,
      amountTTC,
      exchangeRate,
      exchangeRateDate: issueDate,
      convertedAmountHT,
      attachmentId,
      exceedReason: cleanString(req.body?.exceedReason || '', 400) || undefined,
      createdById: actor.uid,
      createdByName: actor.displayName,
      createdAt: new Date().toISOString(),
    };

    store.invoices.unshift(inv);
    recordBusinessHistory({
      projectId: project.id,
      entityType: 'invoice',
      entityId: inv.id,
      actor,
      action: `${type === 'avoir' ? 'Avoir' : 'Facture'} ${inv.number}`,
      afterValue: `${inv.convertedAmountHT.toFixed(2)} ${project.currency} HT`,
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.status(201).json({ invoice: inv });
  });

  return router;
}
