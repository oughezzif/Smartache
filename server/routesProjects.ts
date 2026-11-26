import express, { type NextFunction, type Request, type Response } from 'express';
import {
  countWorkedDays,
  getCasablancaTodayISO,
  nextWorkedDayOnOrAfter,
  nthWorkedDayFrom,
  resolveScheduleForTask,
} from '../src/shared/calculationEngine.ts';
import type {
  BaselineRequest,
  BudgetRevision,
  ClosingSignOff,
  MultiDirectorRule,
  PhaseKey,
  Priority,
  Project,
  ProjectPhase,
  ProjectTask,
  TaskExecutionMode,
  TransitionMode,
} from '../src/shared/types.ts';
import { PHASE_CATALOG } from '../src/shared/types.ts';
import { createImmediateAlert, evaluateAllAlerts } from './alertsEngine.ts';
import {
  canActAsRole,
  cleanString,
  makeId,
  recordBusinessHistory,
  saveStore,
  store,
  type StoredUser,
} from './store.ts';

export interface AuthedReq extends Request {
  currentUser?: StoredUser;
}

export function denyAdminContent(req: AuthedReq, res: Response, next: NextFunction): void {
  if (req.currentUser?.role === 'administrateur') {
    res.status(403).json({ error: 'Accès refusé : le rôle Administrateur n’accède pas au contenu des projets.' });
    return;
  }
  next();
}

export function invalidatePendingBaselineRequests(project: Project): void {
  for (const br of project.baselineRequests) {
    if (br.status === 'en_attente') {
      br.status = 'perimee';
      br.decisionNote = 'Périmée automatiquement suite à une modification du planning.';
    }
  }
}

export function bumpPlanningRevision(project: Project, actor: StoredUser, reason: string): void {
  project.planningRevision += 1;
  project.updatedAt = new Date().toISOString();
  invalidatePendingBaselineRequests(project);
  // store last actor info in businessHistory (already recorded by caller)
  void actor;
  void reason;
}

export function tryAutoAdvancePlanningToControl(project: Project, actor: StoredUser): void {
  if (!project.planningLaunched || project.status !== 'actif') return;
  const projectTasks = store.tasks.filter((t) => t.projectId === project.id);
  const leaves = projectTasks.filter((t) => !projectTasks.some((c) => c.parentId === t.id));
  if (leaves.length === 0) return;

  const allDoneOrCancelled = leaves.every((t) => t.status === 'terminee' || t.status === 'annulee');
  if (!allDoneOrCancelled) return;

  const planning = project.phases.find((p) => p.key === 'planning');
  const control = project.phases.find((p) => p.key === 'control');
  const closing = project.phases.find((p) => p.key === 'closing');
  const now = new Date().toISOString();

  if (planning && planning.status !== 'terminee') {
    planning.status = 'terminee';
    planning.completedAt = now;
  }

  if (control && control.status === 'non_demarree') {
    control.status = 'en_cours';
    control.startedAt = now;
    recordBusinessHistory({
      projectId: project.id,
      entityType: 'phase',
      entityId: `${project.id}_control`,
      actor,
      action: 'Ouverture automatique de la phase Contrôle',
      afterValue: 'Toutes les tâches sont terminées ou annulées',
    });
  } else if (!control && closing && closing.status === 'non_demarree') {
    closing.status = 'en_cours';
    closing.startedAt = now;
  }
}

export function createProjectsRouter(
  requireAuth: express.RequestHandler,
  broadcastSync: () => void
): express.Router {
  const router = express.Router();

  // Create Project (§3.1, §3.2, §3.6 MIGRATION)
  router.post('/', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);

    const isMigration = Boolean(req.body?.isMigration);
    if (isMigration) {
      if (!store.settings.migrationModeEnabled || todayISO > store.settings.migrationEndsAt) {
        res.status(403).json({ error: 'Le mode Reprise de l’existant est désactivé ou expiré.' });
        return;
      }
      if (!canActAsRole(actor, 'directeur', 'create_migration_project', todayISO).allowed) {
        res.status(403).json({ error: 'Seul un Directeur peut créer un projet en mode Reprise de l’existant.' });
        return;
      }
    }

    const title = cleanString(req.body?.title, 140);
    const description = cleanString(req.body?.description || '', 1500);
    const priority = (req.body?.priority as Priority) || 'moyenne';
    const responsable0Id = cleanString(req.body?.responsable0Id, 80);
    const workScheduleId = cleanString(req.body?.workScheduleId, 80) || store.workSchedules[0]?.id || 'sched_ouvres';
    const currency = cleanString(req.body?.currency, 8) || store.settings.defaultCurrency;
    const showAmountsToResponsable = Boolean(req.body?.showAmountsToResponsable);
    const multiDirectorRule: MultiDirectorRule =
      req.body?.multiDirectorRule === 'un_seul_suffit' ? 'un_seul_suffit' : 'accord_de_tous';
    const targetStartDate = cleanString(req.body?.targetStartDate, 10) || todayISO;
    const targetEndDate = cleanString(req.body?.targetEndDate, 10) || todayISO;

    if (!title || !responsable0Id) {
      res.status(400).json({ error: 'Titre et Responsable 0 sont obligatoires.' });
      return;
    }

    const r0 = store.users.find((u) => u.uid === responsable0Id && u.status === 'actif');
    if (!r0) {
      res.status(400).json({ error: 'Responsable 0 introuvable ou inactif.' });
      return;
    }
    if (r0.role === 'directeur' || r0.role === 'administrateur') {
      res.status(400).json({ error: 'Un Directeur ou Administrateur ne peut pas être Responsable 0.' });
      return;
    }

    const requestedPhasesInput = Array.isArray(req.body?.phases) ? req.body.phases : [];
    const selectedKeys = new Set<PhaseKey>(
      requestedPhasesInput.map((p: { key?: PhaseKey }) => p.key).filter(Boolean) as PhaseKey[]
    );
    selectedKeys.add('planning'); // Planification toujours présente dès création

    if (selectedKeys.has('closing')) {
      selectedKeys.add('control');
      selectedKeys.add('planning');
    }
    if (selectedKeys.has('control')) {
      selectedKeys.add('planning');
    }

    const now = new Date().toISOString();
    const builtPhases: ProjectPhase[] = [];

    for (const cat of PHASE_CATALOG) {
      if (!selectedKeys.has(cat.key)) continue;
      const inputPh = requestedPhasesInput.find((p: { key?: PhaseKey }) => p.key === cat.key) || {};
      const rawStakeholders = Array.isArray(inputPh.stakeholders) ? inputPh.stakeholders : [];
      const seenUids = new Set<string>();
      let stakeholders: { uid: string; displayName: string; isLead: boolean }[] = [];

      if (cat.key === 'validation') {
        for (const s of rawStakeholders as { uid: string; isLead?: boolean }[]) {
          if (!s?.uid || seenUids.has(s.uid)) continue;
          const u = store.users.find((x) => x.uid === s.uid && x.role === 'directeur' && x.status === 'actif');
          if (u) {
            seenUids.add(u.uid);
            stakeholders.push({ uid: u.uid, displayName: u.displayName, isLead: Boolean(s.isLead) });
          }
        }
        if (stakeholders.length === 0) {
          res.status(400).json({ error: 'La phase Validation exige au moins un Directeur pilote.' });
          return;
        }
        if (!stakeholders.some((s) => s.isLead)) {
          stakeholders[0].isLead = true;
        }
      } else if (cat.key === 'control') {
        seenUids.add(r0.uid);
        stakeholders.push({ uid: r0.uid, displayName: r0.displayName, isLead: true });
        for (const s of rawStakeholders as { uid: string; isLead?: boolean }[]) {
          if (!s?.uid || seenUids.has(s.uid)) continue;
          const u = store.users.find(
            (x) => x.uid === s.uid && x.status === 'actif' && x.role !== 'administrateur' && x.role !== 'directeur'
          );
          if (u) {
            seenUids.add(u.uid);
            stakeholders.push({ uid: u.uid, displayName: u.displayName, isLead: Boolean(s.isLead) });
          }
        }
      } else {
        for (const s of rawStakeholders as { uid: string; isLead?: boolean }[]) {
          if (!s?.uid || seenUids.has(s.uid)) continue;
          const u = store.users.find((x) => x.uid === s.uid && x.status === 'actif' && x.role !== 'administrateur');
          if (u) {
            seenUids.add(u.uid);
            stakeholders.push({ uid: u.uid, displayName: u.displayName, isLead: Boolean(s.isLead) });
          }
        }
        if (stakeholders.length === 0) {
          stakeholders = [{ uid: r0.uid, displayName: r0.displayName, isLead: true }];
        } else if (!stakeholders.some((s) => s.isLead)) {
          stakeholders[0].isLead = true;
        }
      }

      let transition: TransitionMode =
        inputPh.transitionFromPrev === 'bloquant' ? 'bloquant' : 'libre';
      if (cat.key === 'control' || cat.key === 'closing') {
        transition = 'bloquant';
      }

      const closedOutOfTool = isMigration && Boolean(inputPh.closedOutOfTool) && cat.key !== 'planning' && cat.key !== 'control' && cat.key !== 'closing';

      builtPhases.push({
        key: cat.key,
        label: cat.label,
        order: cat.order,
        status: closedOutOfTool
          ? 'terminee'
          : cat.key === 'planning'
          ? 'en_cours'
          : 'non_demarree',
        transitionFromPrev: transition,
        stakeholders,
        startedAt: cat.key === 'planning' || closedOutOfTool ? now : undefined,
        completedAt: closedOutOfTool ? now : undefined,
        closedOutOfTool: closedOutOfTool || undefined,
      });
    }

    // Activate the first non-planning phase if not closed out-of-tool
    const firstNonPlanning = builtPhases.find(
      (p) => p.key !== 'planning' && p.key !== 'control' && p.key !== 'closing' && p.status === 'non_demarree'
    );
    if (firstNonPlanning) {
      firstNonPlanning.status = 'en_cours';
      firstNonPlanning.startedAt = now;
    }

    // Populate closing sign-offs skeleton
    const closingPh = builtPhases.find((p) => p.key === 'closing');
    if (closingPh) {
      closingPh.closingSignOffs = closingPh.stakeholders.map((s) => {
        const u = store.users.find((x) => x.uid === s.uid);
        return {
          uid: s.uid,
          displayName: s.displayName,
          role: u?.role || 'responsable',
          signed: false,
        };
      });
    }

    const customCode = cleanString(req.body?.code || '', 30).toUpperCase();
    const year = todayISO.slice(0, 4);
    const nextNum = String(store.projects.length + 1).padStart(2, '0');
    const code = customCode || `PRJ-${year}-${nextNum}`;
    if (store.projects.some((p) => p.code === code)) {
      res.status(409).json({ error: `Le code projet ${code} existe déjà.` });
      return;
    }

    const project: Project = {
      id: makeId('proj'),
      code,
      title,
      description,
      priority,
      status: 'actif',
      responsable0Id: r0.uid,
      responsable0Name: r0.displayName,
      createdById: actor.uid,
      createdByName: actor.displayName,
      workScheduleId,
      currency,
      showAmountsToResponsable,
      multiDirectorRule,
      planningLaunched: false,
      planningRevision: 1,
      budgetRevision: isMigration && Array.isArray(req.body?.migrationBudgetLines) && req.body.migrationBudgetLines.length > 0 ? 1 : 0,
      targetStartDate,
      targetEndDate,
      phases: builtPhases,
      baselines: [],
      currentBaselineVersion: 0,
      baselineRequests: [],
      migration: isMigration ? { isMigrated: true, migrationDate: todayISO } : undefined,
      attachedSupplierIds: [],
      createdAt: now,
      updatedAt: now,
    };

    store.projects.unshift(project);

    const rawInitialTasks = Array.isArray(req.body?.initialTasks) ? req.body.initialTasks : [];
    let initialTaskIdx = 0;
    for (const rawTask of rawInitialTasks) {
      const tTitle = cleanString(rawTask?.title || '', 160);
      if (!tTitle) continue;
      const tStart =
        typeof rawTask?.startDate === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(rawTask.startDate)
          ? rawTask.startDate
          : targetStartDate;
      const tEndRaw =
        typeof rawTask?.endDate === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(rawTask.endDate)
          ? rawTask.endDate
          : targetEndDate;
      const tEnd = tEndRaw >= tStart ? tEndRaw : tStart;

      const requestedAssigneeId = cleanString(rawTask?.assigneeId || '', 80);
      const tAssignee =
        store.users.find((u) => u.uid === requestedAssigneeId && u.status === 'actif' && u.role !== 'administrateur') ||
        r0;

      const rawCoPilots: string[] = Array.isArray(rawTask?.coPilotIds) ? rawTask.coPilotIds : [];
      const coPilotUsers = rawCoPilots
        .filter((id, idx) => id && id !== tAssignee.uid && rawCoPilots.indexOf(id) === idx)
        .map((id) => store.users.find((u) => u.uid === id && u.status === 'actif' && u.role !== 'administrateur'))
        .filter((u): u is NonNullable<typeof u> => Boolean(u));

      initialTaskIdx += 1;
      const tMode: TaskExecutionMode = rawTask?.executionMode === 'externe' ? 'externe' : 'interne';
      const newTask: ProjectTask = {
        id: makeId('tsk'),
        projectId: project.id,
        parentId: null,
        level: 1,
        code: String(initialTaskIdx),
        title: tTitle,
        description: cleanString(rawTask?.description || '', 1000),
        priority: (['critique', 'haute', 'moyenne', 'basse'].includes(rawTask?.priority)
          ? rawTask.priority
          : 'moyenne') as Priority,
        startDate: tStart,
        endDate: tEnd,
        executionMode: tMode,
        departmentId: tAssignee.departmentId,
        departmentName: tAssignee.departmentName,
        assigneeId: tAssignee.uid,
        assigneeName: tAssignee.displayName,
        coPilotIds: coPilotUsers.length > 0 ? coPilotUsers.map((u) => u.uid) : undefined,
        coPilotNames: coPilotUsers.length > 0 ? coPilotUsers.map((u) => u.displayName) : undefined,
        dependencies: [],
        progress: 0,
        status: 'a_faire',
        createdBy: actor.uid,
        createdAt: now,
        updatedAt: now,
      };
      store.tasks.push(newTask);
    }

    if (isMigration && Array.isArray(req.body?.migrationBudgetLines) && req.body.migrationBudgetLines.length > 0) {
      const brev: BudgetRevision = {
        id: makeId('brev'),
        projectId: project.id,
        version: 1,
        status: 'validee',
        reason: 'Budget pré-validé lors de la reprise de l’existant',
        lines: req.body.migrationBudgetLines.map((l: { category?: string; designation?: string; plannedAmount?: number }) => ({
          id: makeId('bl'),
          category: cleanString(l.category || 'Général', 80),
          designation: cleanString(l.designation || 'Ligne reprise', 140),
          plannedAmount: Number(l.plannedAmount) || 0,
          settled: false,
        })),
        requestedById: actor.uid,
        requestedByName: actor.displayName,
        requestedAt: now,
        decidedById: actor.uid,
        decidedByName: actor.displayName,
        decidedAt: now,
        fromMigration: true,
      };
      store.budgetRevisions.unshift(brev);
    }

    recordBusinessHistory({
      projectId: project.id,
      entityType: 'project',
      entityId: project.id,
      actor,
      action: isMigration ? 'Création projet (Reprise de l’existant)' : 'Création du projet',
      afterValue: `${project.code} — ${project.title}`,
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.status(201).json({ project });
  });

  // Update project settings / R0 replacement / financial visibility
  router.patch('/:id', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const project = store.projects.find((p) => p.id === req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Projet introuvable.' });
      return;
    }
    if (project.status === 'clos' || project.status === 'annule') {
      res.status(400).json({ error: 'Projet clos ou annulé : modification interdite.' });
      return;
    }

    const isDirector = canActAsRole(actor, 'directeur', 'edit_project', todayISO);
    const isRA = canActAsRole(actor, 'responsable_achat', 'edit_project', todayISO);
    const isR0 = project.responsable0Id === actor.uid;

    if (!isDirector.allowed && !isRA.allowed && !isR0) {
      res.status(403).json({ error: 'Permissions insuffisantes.' });
      return;
    }

    if (typeof req.body?.showAmountsToResponsable === 'boolean') {
      if (!isDirector.allowed && !isRA.allowed) {
        res.status(403).json({ error: 'Seule la Direction ou les Achats peuvent modifier la visibilité des montants.' });
        return;
      }
      project.showAmountsToResponsable = req.body.showAmountsToResponsable;
    }

    if (typeof req.body?.responsable0Id === 'string' && req.body.responsable0Id !== project.responsable0Id) {
      if (!isDirector.allowed) {
        res.status(403).json({ error: 'Seule la Direction peut remplacer le Responsable 0.' });
        return;
      }
      const nextR0 = store.users.find((u) => u.uid === req.body.responsable0Id && u.status === 'actif');
      if (!nextR0 || nextR0.role === 'directeur' || nextR0.role === 'administrateur') {
        res.status(400).json({ error: 'Nouveau Responsable 0 invalide.' });
        return;
      }
      const prevR0Id = project.responsable0Id;
      const prevName = project.responsable0Name;
      project.responsable0Id = nextR0.uid;
      project.responsable0Name = nextR0.displayName;
      const ctrlPh = project.phases.find((p) => p.key === 'control');
      if (ctrlPh) {
        const extraCoPilots = ctrlPh.stakeholders.filter((s) => s.uid !== prevR0Id && s.uid !== nextR0.uid);
        ctrlPh.stakeholders = [{ uid: nextR0.uid, displayName: nextR0.displayName, isLead: true }, ...extraCoPilots];
      }
      recordBusinessHistory({
        projectId: project.id,
        entityType: 'project',
        entityId: project.id,
        actor,
        onBehalfOf: isDirector.delegation?.delegatorName,
        action: 'Remplacement du Responsable 0',
        beforeValue: prevName,
        afterValue: nextR0.displayName,
      });
    }

    if (typeof req.body?.title === 'string' && req.body.title.trim()) {
      project.title = cleanString(req.body.title, 140);
    }
    if (typeof req.body?.description === 'string') {
      project.description = cleanString(req.body.description, 1500);
    }
    if (typeof req.body?.priority === 'string') {
      project.priority = req.body.priority as Priority;
    }
    if (Array.isArray(req.body?.attachedSupplierIds)) {
      project.attachedSupplierIds = req.body.attachedSupplierIds;
    }

    project.updatedAt = new Date().toISOString();
    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ project });
  });

  // Start or Complete a non-validation/non-closing phase
  router.post('/:id/phases/:phaseKey/complete', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const project = store.projects.find((p) => p.id === req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Projet introuvable.' });
      return;
    }
    if (project.status !== 'actif') {
      res.status(400).json({ error: 'Action impossible sur un projet non actif.' });
      return;
    }
    const idx = project.phases.findIndex((p) => p.key === req.params.phaseKey);
    if (idx === -1) {
      res.status(404).json({ error: 'Phase introuvable.' });
      return;
    }
    const phase = project.phases[idx];
    if (phase.key === 'validation' || phase.key === 'control' || phase.key === 'closing') {
      res.status(400).json({ error: 'Utilisez le workflow dédié pour cette phase.' });
      return;
    }

    const isLead = phase.stakeholders.some((s) => s.uid === actor.uid && s.isLead);
    const isR0 = project.responsable0Id === actor.uid;
    const dirDel = canActAsRole(actor, 'directeur', 'complete_phase', todayISO);
    if (!isLead && !isR0 && !dirDel.allowed) {
      res.status(403).json({ error: 'Seul le responsable de phase ou le Responsable 0 peut clôturer cette phase.' });
      return;
    }

    // Check previous blocking phase
    if (idx > 0 && phase.transitionFromPrev === 'bloquant') {
      const prev = project.phases[idx - 1];
      if (prev.key !== 'planning' && prev.status !== 'terminee') {
        res.status(409).json({ error: `Transition bloquante : la phase « ${prev.label} » doit d’abord être terminée.` });
        return;
      }
    }

    const now = new Date().toISOString();
    phase.status = 'terminee';
    phase.completedAt = now;
    if (typeof req.body?.notes === 'string' && req.body.notes.trim()) {
      phase.notes = cleanString(req.body.notes, 1000);
    }

    // Activate next phase if non-control/non-closing
    const nextPh = project.phases[idx + 1];
    if (nextPh && nextPh.status === 'non_demarree' && nextPh.key !== 'control' && nextPh.key !== 'closing') {
      nextPh.status = 'en_cours';
      nextPh.startedAt = now;
      createImmediateAlert({
        code: 'AL8',
        recipientIds: [project.responsable0Id, ...nextPh.stakeholders.map((s) => s.uid)],
        projectId: project.id,
        entityId: `${project.id}_${nextPh.key}`,
        occurrenceKey: `al8_${project.id}_${nextPh.key}_${now}`,
        title: `[${project.code}] Phase « ${nextPh.label} » prête`,
        message: `La phase « ${phase.label} » est terminée ; « ${nextPh.label} » est désormais ouverte.`,
      });
    }

    recordBusinessHistory({
      projectId: project.id,
      entityType: 'phase',
      entityId: `${project.id}_${phase.key}`,
      actor,
      action: `Clôture de la phase « ${phase.label} »`,
      afterValue: 'Terminée',
    });

    project.updatedAt = now;
    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ project });
  });

  // Validation Decision (D5)
  router.post('/:id/validation-decision', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const dirPerm = canActAsRole(actor, 'directeur', 'validation_decision', todayISO);
    if (!dirPerm.allowed) {
      res.status(403).json({ error: 'Seul un Directeur (ou délégataire autorisé) peut statuer sur la validation.' });
      return;
    }

    const project = store.projects.find((p) => p.id === req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Projet introuvable.' });
      return;
    }
    const valPhase = project.phases.find((p) => p.key === 'validation');
    if (!valPhase || valPhase.status !== 'en_cours') {
      res.status(409).json({
        error: 'Conflit de décision : la phase de validation n’est plus en attente (une décision a déjà été enregistrée).',
      });
      return;
    }

    const effectiveUid = dirPerm.delegation ? dirPerm.delegation.delegatorId : actor.uid;
    const isStakeholder = valPhase.stakeholders.some((s) => s.uid === effectiveUid);
    if (!isStakeholder && actor.role !== 'directeur') {
      res.status(403).json({ error: 'Vous n’êtes pas intervenant désigné sur cette phase de validation.' });
      return;
    }

    const decision = req.body?.decision as 'valide' | 'a_revoir' | 'rejete';
    const comment = cleanString(req.body?.comment || '', 1000);
    const returnToPhase = req.body?.returnToPhase as PhaseKey | undefined;
    if (!['valide', 'a_revoir', 'rejete'].includes(decision)) {
      res.status(400).json({ error: 'Décision invalide.' });
      return;
    }
    if ((decision === 'a_revoir' || decision === 'rejete') && !comment) {
      res.status(400).json({ error: 'Un motif est obligatoire pour renvoyer ou rejeter.' });
      return;
    }

    const now = new Date().toISOString();
    if (!valPhase.decisions) valPhase.decisions = [];
    valPhase.decisions = valPhase.decisions.filter((d) => d.uid !== effectiveUid);
    valPhase.decisions.push({
      uid: effectiveUid,
      displayName: actor.displayName,
      decision,
      comment,
      returnToPhase,
      decidedAt: now,
      byDelegationOf: dirPerm.delegation?.delegatorName,
    });

    if (decision === 'rejete') {
      project.status = 'annule';
      valPhase.status = 'terminee';
      valPhase.completedAt = now;
      createImmediateAlert({
        code: 'AL4',
        recipientIds: [project.responsable0Id],
        projectId: project.id,
        entityId: project.id,
        occurrenceKey: `al4_reject_${project.id}`,
        title: `[${project.code}] Projet rejeté en validation`,
        message: `${actor.displayName} a rejeté le projet : ${comment}`,
      });
    } else if (decision === 'a_revoir') {
      valPhase.status = 'non_demarree';
      const targetKey = returnToPhase || project.phases[0]?.key || 'feasibility';
      const targetPh = project.phases.find((p) => p.key === targetKey);
      if (targetPh) {
        targetPh.status = 'a_revoir';
      }
      createImmediateAlert({
        code: 'AL4',
        recipientIds: [project.responsable0Id, ...(targetPh?.stakeholders.map((s) => s.uid) || [])],
        projectId: project.id,
        entityId: `${project.id}_${targetKey}`,
        occurrenceKey: `al4_rev_${project.id}_${now}`,
        title: `[${project.code}] Validation à revoir`,
        message: `${actor.displayName} demande une reprise sur « ${targetPh?.label || targetKey} » : ${comment}`,
      });
    } else {
      // Check multiDirectorRule
      const allValidated =
        project.multiDirectorRule === 'un_seul_suffit' ||
        valPhase.stakeholders.every((s) =>
          valPhase.decisions?.some((d) => d.uid === s.uid && d.decision === 'valide')
        );
      if (allValidated) {
        valPhase.status = 'terminee';
        valPhase.completedAt = now;
        const valIdx = project.phases.findIndex((p) => p.key === 'validation');
        const nextPh = project.phases[valIdx + 1];
        if (nextPh && nextPh.status === 'non_demarree' && nextPh.key !== 'control' && nextPh.key !== 'closing') {
          nextPh.status = 'en_cours';
          nextPh.startedAt = now;
        }
      }
    }

    recordBusinessHistory({
      projectId: project.id,
      entityType: 'validation',
      entityId: project.id,
      actor,
      onBehalfOf: dirPerm.delegation?.delegatorName,
      action: `Décision Direction : ${decision}`,
      afterValue: comment || decision,
    });

    project.updatedAt = now;
    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ project });
  });

  // Suspend & Resume (D7 / R13)
  router.post('/:id/suspend', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const project = store.projects.find((p) => p.id === req.params.id);
    if (!project || project.status !== 'actif') {
      res.status(400).json({ error: 'Seul un projet actif peut être suspendu.' });
      return;
    }
    const isDir = canActAsRole(actor, 'directeur', 'suspend_project', todayISO);
    if (!isDir.allowed && project.responsable0Id !== actor.uid) {
      res.status(403).json({ error: 'Permission refusée pour suspendre le projet.' });
      return;
    }
    const reasonCategory = cleanString(req.body?.reasonCategory, 80);
    const reasonComment = cleanString(req.body?.reasonComment, 600);
    const plannedResumeDate = cleanString(req.body?.plannedResumeDate || '', 10);
    if (!reasonCategory || !reasonComment) {
      res.status(400).json({ error: 'Catégorie et commentaire de suspension obligatoires.' });
      return;
    }

    project.status = 'suspendu';
    project.suspension = {
      suspendedAt: todayISO,
      suspendedBy: actor.displayName,
      reasonCategory,
      reasonComment,
      plannedResumeDate: plannedResumeDate || undefined,
    };
    project.updatedAt = new Date().toISOString();

    recordBusinessHistory({
      projectId: project.id,
      entityType: 'project',
      entityId: project.id,
      actor,
      onBehalfOf: isDir.delegation?.delegatorName,
      action: 'Suspension du projet',
      reason: `${reasonCategory} — ${reasonComment}`,
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ project });
  });

  router.post('/:id/resume', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const project = store.projects.find((p) => p.id === req.params.id);
    if (!project || project.status !== 'suspendu' || !project.suspension) {
      res.status(400).json({ error: 'Ce projet n’est pas suspendu.' });
      return;
    }
    const isDir = canActAsRole(actor, 'directeur', 'resume_project', todayISO);
    if (!isDir.allowed && project.responsable0Id !== actor.uid) {
      res.status(403).json({ error: 'Permission refusée pour reprendre le projet.' });
      return;
    }

    const sched = resolveScheduleForTask({}, project, store.workSchedules);
    const pauseWorkedDays = countWorkedDays(project.suspension.suspendedAt, todayISO, sched, store.holidays);
    const shiftUnstartedTasks = Boolean(req.body?.shiftUnstartedTasks);
    let shiftedCount = 0;

    if (shiftUnstartedTasks && pauseWorkedDays > 0) {
      const projectTasks = store.tasks.filter((t) => t.projectId === project.id);
      for (const task of projectTasks) {
        const hasChildren = projectTasks.some((c) => c.parentId === task.id);
        if (hasChildren || task.status !== 'a_faire') continue;
        const tSched = resolveScheduleForTask(task, project, store.workSchedules);
        const dur = Math.max(1, countWorkedDays(task.startDate, task.endDate, tSched, store.holidays));
        const shiftedStart = nthWorkedDayFrom(
          nextWorkedDayOnOrAfter(task.startDate, tSched, store.holidays),
          pauseWorkedDays + 1,
          tSched,
          store.holidays
        );
        task.startDate = shiftedStart;
        task.endDate = nthWorkedDayFrom(shiftedStart, dur, tSched, store.holidays);
        task.updatedAt = new Date().toISOString();
        shiftedCount += 1;
      }
      if (shiftedCount > 0) {
        bumpPlanningRevision(project, actor, 'Décalage post-suspension');
      }
    }

    project.status = 'actif';
    const prevReason = project.suspension.reasonCategory;
    project.suspension = undefined;
    project.updatedAt = new Date().toISOString();

    recordBusinessHistory({
      projectId: project.id,
      entityType: 'project',
      entityId: project.id,
      actor,
      onBehalfOf: isDir.delegation?.delegatorName,
      action: 'Reprise du projet',
      beforeValue: `Suspendu (${prevReason}, ${pauseWorkedDays} j ouvrés)`,
      afterValue: shiftUnstartedTasks ? `Repris avec décalage de ${shiftedCount} tâche(s)` : 'Repris sans décalage',
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ project, pauseWorkedDays, shiftedCount });
  });

  // Cancel project (Directeur only)
  router.post('/:id/cancel', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const isDir = canActAsRole(actor, 'directeur', 'cancel_project', todayISO);
    if (!isDir.allowed) {
      res.status(403).json({ error: 'Seul un Directeur peut annuler un projet.' });
      return;
    }
    const project = store.projects.find((p) => p.id === req.params.id);
    if (!project || project.status === 'clos') {
      res.status(400).json({ error: 'Projet introuvable ou déjà clos.' });
      return;
    }
    const reason = cleanString(req.body?.reason || '', 600);
    if (!reason) {
      res.status(400).json({ error: 'Un motif d’annulation est obligatoire.' });
      return;
    }

    project.status = 'annule';
    project.updatedAt = new Date().toISOString();
    recordBusinessHistory({
      projectId: project.id,
      entityType: 'project',
      entityId: project.id,
      actor,
      onBehalfOf: isDir.delegation?.delegatorName,
      action: 'Annulation du projet',
      reason,
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ project });
  });

  // Launch Planning (Lancer -> V1 Baseline)
  router.post('/:id/launch-planning', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const project = store.projects.find((p) => p.id === req.params.id);
    if (!project || project.status !== 'actif') {
      res.status(400).json({ error: 'Projet introuvable ou inactif.' });
      return;
    }
    const planningPh = project.phases.find((p) => p.key === 'planning');
    const isPlanningLead = planningPh?.stakeholders.some((s) => s.uid === actor.uid && s.isLead);
    if (project.responsable0Id !== actor.uid && !isPlanningLead && actor.role !== 'directeur') {
      res.status(403).json({ error: 'Permission refusée pour lancer le planning.' });
      return;
    }

    const projectTasks = store.tasks.filter((t) => t.projectId === project.id);
    if (projectTasks.length === 0) {
      res.status(400).json({ error: 'Ajoutez au moins une tâche avant de lancer le planning.' });
      return;
    }

    const now = new Date().toISOString();
    const taskDates: Record<string, { startDate: string; endDate: string; duration: number }> = {};
    for (const t of projectTasks) {
      const sched = resolveScheduleForTask(t, project, store.workSchedules);
      t.refStartDate = t.startDate;
      t.refEndDate = t.endDate;
      if (!t.refV1StartDate) {
        t.refV1StartDate = t.startDate;
        t.refV1EndDate = t.endDate;
      }
      taskDates[t.id] = {
        startDate: t.startDate,
        endDate: t.endDate,
        duration: countWorkedDays(t.startDate, t.endDate, sched, store.holidays),
      };
    }

    project.planningLaunched = true;
    project.planningLaunchedAt = now;
    project.currentBaselineVersion = 1;
    project.baselines.push({
      version: 1,
      createdAt: now,
      createdBy: actor.displayName,
      reason: 'Lancement officiel du planning (Référence V1)',
      taskDates,
    });
    project.updatedAt = now;

    recordBusinessHistory({
      projectId: project.id,
      entityType: 'baseline',
      entityId: project.id,
      actor,
      action: 'Lancement du planning (Baseline V1)',
      afterValue: `${projectTasks.length} tâche(s) figée(s)`,
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ project });
  });

  // Baseline Request & Approval (D11)
  router.post('/:id/baseline-request', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const project = store.projects.find((p) => p.id === req.params.id);
    if (!project || !project.planningLaunched) {
      res.status(400).json({ error: 'Le planning doit d’abord être lancé.' });
      return;
    }
    const reason = cleanString(req.body?.reason, 600);
    if (!reason) {
      res.status(400).json({ error: 'Un motif de re-baselining est obligatoire.' });
      return;
    }

    const projectTasks = store.tasks.filter((t) => t.projectId === project.id);
    const proposedDates: Record<string, { startDate: string; endDate: string }> = {};
    for (const t of projectTasks) {
      proposedDates[t.id] = { startDate: t.startDate, endDate: t.endDate };
    }

    const br: BaselineRequest = {
      id: makeId('breq'),
      projectId: project.id,
      requestedById: actor.uid,
      requestedByName: actor.displayName,
      requestedAt: new Date().toISOString(),
      reason,
      planningRevisionAtRequest: project.planningRevision,
      proposedDates,
      status: 'en_attente',
    };
    project.baselineRequests.unshift(br);
    project.updatedAt = new Date().toISOString();

    recordBusinessHistory({
      projectId: project.id,
      entityType: 'baseline',
      entityId: br.id,
      actor,
      action: 'Demande de nouvelle référence planning',
      reason,
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.status(201).json({ baselineRequest: br, project });
  });

  router.post('/:id/baseline-request/:reqId/decide', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const dirPerm = canActAsRole(actor, 'directeur', 'decide_baseline', todayISO);
    if (!dirPerm.allowed) {
      res.status(403).json({ error: 'Seul un Directeur peut valider une nouvelle référence.' });
      return;
    }
    const project = store.projects.find((p) => p.id === req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Projet introuvable.' });
      return;
    }
    const br = project.baselineRequests.find((b) => b.id === req.params.reqId);
    if (!br) {
      res.status(404).json({ error: 'Demande introuvable.' });
      return;
    }
    if (br.status !== 'en_attente' || br.planningRevisionAtRequest !== project.planningRevision) {
      br.status = 'perimee';
      saveStore();
      res.status(409).json({ error: 'Demande périmée suite à une modification du planning.' });
      return;
    }

    const decision = req.body?.decision as 'validee' | 'refusee';
    const note = cleanString(req.body?.note || '', 500);
    const now = new Date().toISOString();
    br.status = decision === 'validee' ? 'validee' : 'refusee';
    br.decidedBy = actor.displayName;
    br.decidedAt = now;
    br.decisionNote = note || undefined;

    if (decision === 'validee') {
      const nextVersion = project.currentBaselineVersion + 1;
      const taskDates: Record<string, { startDate: string; endDate: string; duration: number }> = {};
      const projectTasks = store.tasks.filter((t) => t.projectId === project.id);
      for (const t of projectTasks) {
        const pDates = br.proposedDates[t.id] || { startDate: t.startDate, endDate: t.endDate };
        t.refStartDate = pDates.startDate;
        t.refEndDate = pDates.endDate;
        const sched = resolveScheduleForTask(t, project, store.workSchedules);
        taskDates[t.id] = {
          startDate: pDates.startDate,
          endDate: pDates.endDate,
          duration: countWorkedDays(pDates.startDate, pDates.endDate, sched, store.holidays),
        };
      }
      project.currentBaselineVersion = nextVersion;
      project.baselines.push({
        version: nextVersion,
        createdAt: now,
        createdBy: br.requestedByName,
        approvedBy: actor.displayName,
        reason: br.reason,
        taskDates,
      });
    }

    recordBusinessHistory({
      projectId: project.id,
      entityType: 'baseline',
      entityId: br.id,
      actor,
      onBehalfOf: dirPerm.delegation?.delegatorName,
      action: decision === 'validee' ? `Validation référence V${project.currentBaselineVersion}` : 'Refus de re-baselining',
      reason: note,
    });

    project.updatedAt = now;
    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ project });
  });

  // Control Phase (R9 / R10 / R11)
  router.post('/:id/control/:taskId/decide', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const project = store.projects.find((p) => p.id === req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Projet introuvable.' });
      return;
    }
    const ctrl = project.phases.find((p) => p.key === 'control');
    if (!ctrl || ctrl.status !== 'en_cours') {
      res.status(400).json({ error: 'La phase Contrôle n’est pas ouverte.' });
      return;
    }
    if (project.responsable0Id !== actor.uid) {
      res.status(403).json({ error: 'Seul le Responsable 0 effectue le contrôle.' });
      return;
    }

    const task = store.tasks.find((t) => t.id === req.params.taskId && t.projectId === project.id);
    if (!task) {
      res.status(404).json({ error: 'Tâche introuvable.' });
      return;
    }
    const decision = req.body?.decision as 'validee' | 'refusee';
    const note = cleanString(req.body?.note || '', 600);
    if (decision === 'refusee' && !note) {
      res.status(400).json({ error: 'Un motif de refus est obligatoire.' });
      return;
    }

    const now = new Date().toISOString();
    if (decision === 'validee') {
      task.controlStatus = 'validee';
      task.controlBy = actor.displayName;
      task.controlAt = now;
      task.controlNote = note || undefined;
    } else {
      // Refusal reopens task and planning + AL10
      task.controlStatus = 'refusee';
      task.controlBy = actor.displayName;
      task.controlAt = now;
      task.controlNote = note;
      task.status = 'en_cours';
      task.progress = 95;
      task.actualEndDate = undefined;
      task.frozenEr = null;
      task.frozenErRef = null;

      ctrl.status = 'non_demarree';
      const planning = project.phases.find((p) => p.key === 'planning');
      if (planning) {
        planning.status = 'en_cours';
        planning.completedAt = undefined;
      }
      createImmediateAlert({
        code: 'AL10',
        recipientIds: [task.assigneeId, ...(task.coPilotIds || []), project.responsable0Id],
        projectId: project.id,
        entityId: task.id,
        occurrenceKey: `al10_${task.id}_${now}`,
        title: `[${project.code}] Contrôle refusé · ${task.code}`,
        message: `${actor.displayName} a refusé « ${task.title} » : ${note}`,
      });
    }

    // Check if all non-cancelled leaf tasks are controlStatus === 'validee'
    const projectTasks = store.tasks.filter((t) => t.projectId === project.id);
    const activeLeaves = projectTasks.filter(
      (t) => !projectTasks.some((c) => c.parentId === t.id) && t.status !== 'annulee'
    );
    if (decision === 'validee' && activeLeaves.every((t) => t.controlStatus === 'validee')) {
      ctrl.status = 'terminee';
      ctrl.completedAt = now;
      const closing = project.phases.find((p) => p.key === 'closing');
      if (closing && closing.status === 'non_demarree') {
        closing.status = 'en_cours';
        closing.startedAt = now;
      }
    }

    recordBusinessHistory({
      projectId: project.id,
      entityType: 'control',
      entityId: task.id,
      actor,
      action: decision === 'validee' ? `Contrôle validé (${task.code})` : `Contrôle refusé (${task.code})`,
      reason: note,
    });

    project.updatedAt = now;
    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ project });
  });

  router.post('/:id/control/validate-all', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const project = store.projects.find((p) => p.id === req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Projet introuvable.' });
      return;
    }
    const ctrl = project.phases.find((p) => p.key === 'control');
    if (!ctrl || ctrl.status !== 'en_cours') {
      res.status(400).json({ error: 'La phase Contrôle n’est pas ouverte.' });
      return;
    }
    if (project.responsable0Id !== actor.uid) {
      res.status(403).json({ error: 'Seul le Responsable 0 peut clôturer le contrôle.' });
      return;
    }

    const now = new Date().toISOString();
    const projectTasks = store.tasks.filter((t) => t.projectId === project.id);
    for (const t of projectTasks) {
      const isLeaf = !projectTasks.some((c) => c.parentId === t.id);
      if (isLeaf && t.status === 'terminee' && t.controlStatus !== 'validee') {
        t.controlStatus = 'validee';
        t.controlBy = actor.displayName;
        t.controlAt = now;
      }
    }
    ctrl.status = 'terminee';
    ctrl.completedAt = now;
    const closing = project.phases.find((p) => p.key === 'closing');
    if (closing && closing.status === 'non_demarree') {
      closing.status = 'en_cours';
      closing.startedAt = now;
    }

    recordBusinessHistory({
      projectId: project.id,
      entityType: 'control',
      entityId: project.id,
      actor,
      action: 'Validation globale de la phase Contrôle',
    });

    project.updatedAt = now;
    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ project });
  });

  // Closing Phase (D8 / D9)
  router.post('/:id/closing/signoff', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const project = store.projects.find((p) => p.id === req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Projet introuvable.' });
      return;
    }
    const closing = project.phases.find((p) => p.key === 'closing');
    if (!closing || closing.status !== 'en_cours') {
      res.status(400).json({ error: 'La phase Clôture n’est pas ouverte.' });
      return;
    }

    if (!closing.closingSignOffs) {
      closing.closingSignOffs = closing.stakeholders.map((s) => {
        const u = store.users.find((x) => x.uid === s.uid);
        return { uid: s.uid, displayName: s.displayName, role: u?.role || 'responsable', signed: false };
      });
    }

    const dirDel = canActAsRole(actor, 'directeur', 'closing_signoff', todayISO);
    const match = closing.closingSignOffs.find(
      (s) => s.uid === actor.uid || (dirDel.delegation && s.uid === dirDel.delegation.delegatorId)
    );
    if (!match) {
      res.status(403).json({ error: 'Vous n’êtes pas signataire désigné de la clôture.' });
      return;
    }

    const action = req.body?.action === 'cancel' ? 'cancel' : 'sign';
    const comment = cleanString(req.body?.comment || '', 500);
    match.signed = action === 'sign';
    match.signedAt = action === 'sign' ? new Date().toISOString() : undefined;
    match.comment = comment || undefined;
    match.byDelegationOf = dirDel.delegation?.delegatorName;

    recordBusinessHistory({
      projectId: project.id,
      entityType: 'closing',
      entityId: project.id,
      actor,
      onBehalfOf: dirDel.delegation?.delegatorName,
      action: action === 'sign' ? 'Signature partie clôture' : 'Annulation signature clôture',
      afterValue: comment || undefined,
    });

    project.updatedAt = new Date().toISOString();
    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ project });
  });

  router.post('/:id/closing/finalize', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const project = store.projects.find((p) => p.id === req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Projet introuvable.' });
      return;
    }
    const closing = project.phases.find((p) => p.key === 'closing');
    if (!closing || closing.status !== 'en_cours') {
      res.status(400).json({ error: 'La phase Clôture n’est pas ouverte.' });
      return;
    }
    const dirDel = canActAsRole(actor, 'directeur', 'finalize_closing', todayISO);
    if (project.responsable0Id !== actor.uid && !dirDel.allowed) {
      res.status(403).json({ error: 'Seul le Responsable 0 ou la Direction peut prononcer la clôture finale.' });
      return;
    }

    const unsigned = (closing.closingSignOffs || []).filter((s) => !s.signed);
    if (unsigned.length > 0) {
      res.status(409).json({
        error: `Clôture finale impossible : ${unsigned.length} signature(s) de partie manquante(s).`,
      });
      return;
    }

    const now = new Date().toISOString();
    closing.status = 'terminee';
    closing.completedAt = now;
    const finalSign: ClosingSignOff = {
      uid: actor.uid,
      displayName: actor.displayName,
      role: actor.role,
      signed: true,
      signedAt: now,
      byDelegationOf: dirDel.delegation?.delegatorName,
    };
    closing.finalClosingSignOffs = [finalSign];
    project.status = 'clos';
    project.updatedAt = now;

    recordBusinessHistory({
      projectId: project.id,
      entityType: 'project',
      entityId: project.id,
      actor,
      onBehalfOf: dirDel.delegation?.delegatorName,
      action: 'Clôture finale et irréversible du projet',
      afterValue: 'Clos',
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ project });
  });

  return router;
}
