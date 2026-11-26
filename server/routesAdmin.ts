import express, { type Request, type Response } from 'express';
import {
  addDaysISO,
  getCasablancaTodayISO,
  isWorkedDay,
  resolveScheduleForTask,
} from '../src/shared/calculationEngine.ts';
import type {
  AccountStatus,
  Delegation,
  Department,
  HolidayEntry,
  HolidayStatus,
  UserRole,
  WorkSchedule,
} from '../src/shared/types.ts';
import { evaluateAllAlerts } from './alertsEngine.ts';
import { seedCdcReferenceDataset } from './seedCdc.ts';
import {
  cleanString,
  hashPassword,
  makeId,
  recordAdminAudit,
  revokeUserSessions,
  saveStore,
  store,
  stripUserSecrets,
  type StoredUser,
} from './store.ts';

export interface AuthedReq extends Request {
  currentUser?: StoredUser;
}

const VALID_ROLES: UserRole[] = ['administrateur', 'directeur', 'responsable', 'responsable_achat'];
const VALID_STATUSES: AccountStatus[] = ['en_attente', 'actif', 'desactive'];

function detectCalendarConflicts(reasonText: string): number {
  let impacted = 0;
  const now = new Date().toISOString();
  for (const project of store.projects) {
    if (project.status === 'clos' || project.status === 'annule') continue;
    const projectTasks = store.tasks.filter((t) => t.projectId === project.id);
    for (const task of projectTasks) {
      const hasChildren = projectTasks.some((x) => x.parentId === task.id);
      if (hasChildren || task.status === 'terminee' || task.status === 'annulee') continue;
      const sched = resolveScheduleForTask(task, project, store.workSchedules);
      let hasNonWorked = false;
      let cur = task.startDate;
      let guard = 0;
      while (cur <= task.endDate && guard < 1000) {
        if (!isWorkedDay(cur, sched, store.holidays)) {
          hasNonWorked = true;
          break;
        }
        cur = addDaysISO(cur, 1);
        guard += 1;
      }
      if (hasNonWorked) {
        task.calendarConflict = {
          detectedAt: now,
          reason: reasonText,
        };
        impacted += 1;
      }
    }
  }
  return impacted;
}

export function createAdminRouter(
  requireAuth: express.RequestHandler,
  requireAdmin: express.RequestHandler,
  broadcastSync: () => void
): express.Router {
  const router = express.Router();

  // Users CRUD (Admin)
  router.get('/users', requireAuth, requireAdmin, (_req: AuthedReq, res: Response) => {
    res.json({ users: store.users.map(stripUserSecrets) });
  });

  router.post('/users', requireAuth, requireAdmin, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const username = cleanString(req.body?.username, 60).toLowerCase();
    const displayName = cleanString(req.body?.displayName, 100);
    const email = cleanString(req.body?.email, 120);
    const role = req.body?.role as UserRole;
    const departmentId = cleanString(req.body?.departmentId, 80);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const status = (req.body?.status as AccountStatus) || 'actif';

    if (!username || !displayName || !VALID_ROLES.includes(role) || !departmentId) {
      res.status(400).json({ error: 'Identifiant, nom complet, rôle et département sont obligatoires.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
      return;
    }
    if (store.users.some((u) => u.username.toLowerCase() === username)) {
      res.status(409).json({ error: 'Cet identifiant existe déjà.' });
      return;
    }
    const dept = store.departments.find((d) => d.id === departmentId);
    if (!dept) {
      res.status(400).json({ error: 'Département introuvable.' });
      return;
    }

    const { salt, hash } = hashPassword(password);
    const now = new Date().toISOString();
    const created: StoredUser = {
      uid: makeId('usr'),
      username,
      displayName,
      email: email || `${username}@entreprise.ma`,
      role,
      departmentId: dept.id,
      departmentName: dept.name,
      status: VALID_STATUSES.includes(status) ? status : 'actif',
      failedAttempts: 0,
      passwordSalt: salt,
      passwordHash: hash,
      createdAt: now,
      updatedAt: now,
    };

    store.users.push(created);
    recordAdminAudit('USER_CREATED', 'identite', actor, displayName, `Rôle ${role}, département ${dept.name}`);
    saveStore();
    broadcastSync();
    res.status(201).json({ user: stripUserSecrets(created) });
  });

  router.patch('/users/:uid', requireAuth, requireAdmin, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const target = store.users.find((u) => u.uid === req.params.uid);
    if (!target) {
      res.status(404).json({ error: 'Utilisateur introuvable.' });
      return;
    }

    const newRole = req.body?.role as UserRole | undefined;
    const newStatus = req.body?.status as AccountStatus | undefined;
    const newDeptId = cleanString(req.body?.departmentId, 80);
    const newDisplayName = cleanString(req.body?.displayName, 100);
    const newEmail = cleanString(req.body?.email, 120);
    const newPassword = typeof req.body?.password === 'string' ? req.body.password : '';

    if (newStatus === 'desactive' && target.status !== 'desactive') {
      if (target.uid === actor.uid) {
        res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte.' });
        return;
      }
      // §10.3 Block deactivation if active assignments exist — return COUNT ONLY (no project names!)
      const openTasksCount = store.tasks.filter(
        (t) => t.assigneeId === target.uid && t.status !== 'terminee' && t.status !== 'annulee'
      ).length;
      const openInterventionsCount = store.interventions.filter(
        (i) => i.assigneeId === target.uid && i.status !== 'terminee' && i.status !== 'annulee'
      ).length;
      const openR0Count = store.projects.filter(
        (p) => p.responsable0Id === target.uid && (p.status === 'actif' || p.status === 'suspendu')
      ).length;
      const openPhasesCount = store.projects
        .filter((p) => p.status === 'actif' || p.status === 'suspendu')
        .reduce((acc, p) => {
          const cnt = p.phases.filter(
            (ph) =>
              ph.status !== 'terminee' &&
              ph.stakeholders.some((s) => s.uid === target.uid)
          ).length;
          return acc + cnt;
        }, 0);

      const totalBlockers = openTasksCount + openInterventionsCount + openR0Count + openPhasesCount;
      if (totalBlockers > 0) {
        res.status(409).json({
          error: `Désactivation impossible : ce compte est engagé sur ${totalBlockers} élément(s) actif(s) (${openTasksCount} tâche(s), ${openInterventionsCount} intervention(s), ${openR0Count} responsabilité(s) R0, ${openPhasesCount} phase(s) ouverte(s)).`,
        });
        return;
      }
      revokeUserSessions(target.uid);
    }

    if (newRole && VALID_ROLES.includes(newRole)) {
      target.role = newRole;
    }
    if (newStatus && VALID_STATUSES.includes(newStatus)) {
      target.status = newStatus;
      if (newStatus === 'actif') {
        target.failedAttempts = 0;
        target.lockedUntil = undefined;
      }
    }
    if (newDeptId) {
      const dept = store.departments.find((d) => d.id === newDeptId);
      if (dept) {
        target.departmentId = dept.id;
        target.departmentName = dept.name;
      }
    }
    if (newDisplayName) target.displayName = newDisplayName;
    if (newEmail) target.email = newEmail;
    if (newPassword) {
      if (newPassword.length < 8) {
        res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' });
        return;
      }
      const { salt, hash } = hashPassword(newPassword);
      target.passwordSalt = salt;
      target.passwordHash = hash;
    }

    target.updatedAt = new Date().toISOString();
    recordAdminAudit(
      'USER_UPDATED',
      'identite',
      actor,
      target.displayName,
      `Rôle=${target.role}, Statut=${target.status}, Dép=${target.departmentName}`
    );
    saveStore();
    broadcastSync();
    res.json({ user: stripUserSecrets(target) });
  });

  // Departments
  router.get('/departments', requireAuth, (_req: AuthedReq, res: Response) => {
    res.json({ departments: store.departments });
  });

  router.post('/departments', requireAuth, requireAdmin, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const name = cleanString(req.body?.name, 100);
    const code = cleanString(req.body?.code, 16).toUpperCase();
    if (!name || !code) {
      res.status(400).json({ error: 'Nom et code du département requis.' });
      return;
    }
    const dept: Department = {
      id: makeId('dept'),
      name,
      code,
      active: true,
      createdAt: new Date().toISOString(),
    };
    store.departments.push(dept);
    recordAdminAudit('DEPT_CREATED', 'application', actor, name, `Code=${code}`);
    saveStore();
    broadcastSync();
    res.status(201).json({ department: dept });
  });

  router.patch('/departments/:id', requireAuth, requireAdmin, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const dept = store.departments.find((d) => d.id === req.params.id);
    if (!dept) {
      res.status(404).json({ error: 'Département introuvable.' });
      return;
    }
    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
      dept.name = cleanString(req.body.name, 100);
    }
    if (typeof req.body?.active === 'boolean') {
      dept.active = req.body.active;
    }
    recordAdminAudit('DEPT_UPDATED', 'application', actor, dept.name, `Actif=${dept.active}`);
    saveStore();
    broadcastSync();
    res.json({ department: dept });
  });

  // Holidays
  router.get('/holidays', requireAuth, (_req: AuthedReq, res: Response) => {
    res.json({ holidays: store.holidays });
  });

  router.post('/holidays', requireAuth, requireAdmin, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const date = cleanString(req.body?.date, 10);
    const label = cleanString(req.body?.label, 120);
    const status = (req.body?.status as HolidayStatus) || 'confirme';
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !label) {
      res.status(400).json({ error: 'Date (AAAA-MM-JJ) et libellé requis.' });
      return;
    }
    if (store.holidays.some((h) => h.date === date)) {
      res.status(409).json({ error: 'Un jour férié existe déjà à cette date.' });
      return;
    }
    const entry: HolidayEntry = {
      id: makeId('hol'),
      date,
      label,
      status: status === 'previsionnel' ? 'previsionnel' : 'confirme',
      year: Number(date.slice(0, 4)),
    };
    store.holidays.push(entry);
    store.holidays.sort((a, b) => a.date.localeCompare(b.date));
    const impacted = detectCalendarConflicts(`Jour férié ajouté : ${label} (${date})`);
    recordAdminAudit('HOLIDAY_CREATED', 'application', actor, `${date} ${label}`, `Statut=${entry.status}, conflits détectés=${impacted}`);
    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.status(201).json({ holiday: entry, impactedTasksCount: impacted });
  });

  router.patch('/holidays/:id', requireAuth, requireAdmin, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const hol = store.holidays.find((h) => h.id === req.params.id);
    if (!hol) {
      res.status(404).json({ error: 'Jour férié introuvable.' });
      return;
    }
    if (typeof req.body?.label === 'string' && req.body.label.trim()) {
      hol.label = cleanString(req.body.label, 120);
    }
    if (req.body?.status === 'confirme' || req.body?.status === 'previsionnel') {
      hol.status = req.body.status;
    }
    if (typeof req.body?.date === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(req.body.date)) {
      hol.date = req.body.date;
      hol.year = Number(req.body.date.slice(0, 4));
    }
    const impacted = detectCalendarConflicts(`Jour férié modifié : ${hol.label} (${hol.date})`);
    recordAdminAudit('HOLIDAY_UPDATED', 'application', actor, `${hol.date} ${hol.label}`, `Statut=${hol.status}, conflits=${impacted}`);
    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ holiday: hol, impactedTasksCount: impacted });
  });

  router.delete('/holidays/:id', requireAuth, requireAdmin, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const idx = store.holidays.findIndex((h) => h.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Jour férié introuvable.' });
      return;
    }
    const [removed] = store.holidays.splice(idx, 1);
    recordAdminAudit('HOLIDAY_DELETED', 'application', actor, `${removed.date} ${removed.label}`, 'Supprimé');
    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ ok: true });
  });

  // Work Schedules
  router.get('/schedules', requireAuth, (_req: AuthedReq, res: Response) => {
    res.json({ workSchedules: store.workSchedules });
  });

  router.post('/schedules', requireAuth, requireAdmin, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const name = cleanString(req.body?.name, 100);
    const workingDays = Array.isArray(req.body?.workingDays)
      ? req.body.workingDays.filter((n: unknown) => typeof n === 'number' && n >= 0 && n <= 6)
      : [1, 2, 3, 4, 5];
    const applyHolidays = req.body?.applyHolidays !== false;
    const hoursInfo = cleanString(req.body?.hoursInfo || '', 80);
    if (!name || workingDays.length === 0) {
      res.status(400).json({ error: 'Nom et au moins un jour travaillé requis.' });
      return;
    }
    const schedule: WorkSchedule = {
      id: makeId('sched'),
      name,
      workingDays,
      applyHolidays,
      hoursInfo: hoursInfo || undefined,
      periods: Array.isArray(req.body?.periods) ? req.body.periods : [],
      active: true,
      isDefault: false,
    };
    store.workSchedules.push(schedule);
    recordAdminAudit('SCHEDULE_CREATED', 'application', actor, name, `Jours=${workingDays.join(',')}`);
    saveStore();
    broadcastSync();
    res.status(201).json({ schedule });
  });

  router.patch('/schedules/:id', requireAuth, requireAdmin, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const sched = store.workSchedules.find((s) => s.id === req.params.id);
    if (!sched) {
      res.status(404).json({ error: 'Programme introuvable.' });
      return;
    }
    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
      sched.name = cleanString(req.body.name, 100);
    }
    if (Array.isArray(req.body?.workingDays)) {
      sched.workingDays = req.body.workingDays.filter((n: unknown) => typeof n === 'number' && n >= 0 && n <= 6);
    }
    if (typeof req.body?.applyHolidays === 'boolean') {
      sched.applyHolidays = req.body.applyHolidays;
    }
    if (typeof req.body?.hoursInfo === 'string') {
      sched.hoursInfo = cleanString(req.body.hoursInfo, 80);
    }
    if (Array.isArray(req.body?.periods)) {
      sched.periods = req.body.periods;
    }
    if (typeof req.body?.active === 'boolean') {
      sched.active = req.body.active;
    }
    const impacted = detectCalendarConflicts(`Programme modifié : ${sched.name}`);
    recordAdminAudit('SCHEDULE_UPDATED', 'application', actor, sched.name, `Conflits détectés=${impacted}`);
    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ schedule: sched, impactedTasksCount: impacted });
  });

  // Delegations
  router.get('/delegations', requireAuth, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    if (actor.role === 'administrateur' || actor.role === 'directeur') {
      res.json({ delegations: store.delegations });
      return;
    }
    res.json({
      delegations: store.delegations.filter(
        (d) => d.delegatorId === actor.uid || d.delegateeId === actor.uid
      ),
    });
  });

  router.post('/delegations', requireAuth, requireAdmin, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const delegatorId = cleanString(req.body?.delegatorId, 80);
    const delegateeId = cleanString(req.body?.delegateeId, 80);
    const startDate = cleanString(req.body?.startDate, 10);
    const endDate = cleanString(req.body?.endDate, 10);
    const isSingleDirectorException = Boolean(req.body?.isSingleDirectorException);
    const sponsorNote = cleanString(req.body?.sponsorNote || '', 300);

    const delegator = store.users.find((u) => u.uid === delegatorId && u.status === 'actif');
    const delegatee = store.users.find((u) => u.uid === delegateeId && u.status === 'actif');
    if (!delegator || !delegatee || delegator.uid === delegatee.uid) {
      res.status(400).json({ error: 'Délégant et délégataire actifs distincts requis.' });
      return;
    }
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(startDate) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(endDate) || endDate < startDate) {
      res.status(400).json({ error: 'Période de délégation invalide.' });
      return;
    }
    if (delegator.role !== 'directeur' && delegator.role !== delegatee.role && !isSingleDirectorException) {
      res.status(400).json({ error: 'La délégation inter-rôle nécessite une exception de directeur unique.' });
      return;
    }
    if (isSingleDirectorException && !sponsorNote) {
      res.status(400).json({ error: 'Un motif de parrainage est requis pour une exception de directeur unique.' });
      return;
    }

    const del: Delegation = {
      id: makeId('del'),
      delegatorId: delegator.uid,
      delegatorName: delegator.displayName,
      delegateeId: delegatee.uid,
      delegateeName: delegatee.displayName,
      role: delegator.role,
      startDate,
      endDate,
      isSingleDirectorException,
      sponsorNote: sponsorNote || undefined,
      allowedActions: Array.isArray(req.body?.allowedActions) && req.body.allowedActions.length > 0
        ? req.body.allowedActions
        : ['*'],
      active: true,
      createdBy: actor.displayName,
      createdAt: new Date().toISOString(),
    };
    store.delegations.unshift(del);
    recordAdminAudit(
      'DELEGATION_CREATED',
      'identite',
      actor,
      `${delegator.displayName} → ${delegatee.displayName}`,
      `${startDate}..${endDate}${isSingleDirectorException ? ' (Exception directeur unique)' : ''}`
    );
    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.status(201).json({ delegation: del });
  });

  router.patch('/delegations/:id/revoke', requireAuth, requireAdmin, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const del = store.delegations.find((d) => d.id === req.params.id);
    if (!del) {
      res.status(404).json({ error: 'Délégation introuvable.' });
      return;
    }
    del.active = false;
    recordAdminAudit('DELEGATION_REVOKED', 'identite', actor, `${del.delegatorName} → ${del.delegateeName}`, 'Révoquée');
    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ delegation: del });
  });

  // Settings
  router.get('/settings', requireAuth, (_req: AuthedReq, res: Response) => {
    res.json({
      settings: store.settings,
      effectiveTodayISO: getCasablancaTodayISO(store.settings.systemDateOverride),
    });
  });

  router.patch('/settings', requireAuth, requireAdmin, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const s = store.settings;
    if (typeof req.body?.defaultCurrency === 'string' && req.body.defaultCurrency.trim()) {
      s.defaultCurrency = cleanString(req.body.defaultCurrency, 8).toUpperCase();
    }
    if (Array.isArray(req.body?.availableCurrencies)) {
      s.availableCurrencies = req.body.availableCurrencies.map((c: unknown) => cleanString(c, 8).toUpperCase()).filter(Boolean);
    }
    if (typeof req.body?.al1ThresholdPoints === 'number' && req.body.al1ThresholdPoints >= 1) {
      s.al1ThresholdPoints = Math.min(50, Math.round(req.body.al1ThresholdPoints));
    }
    if (typeof req.body?.al9ReminderDays === 'number' && req.body.al9ReminderDays >= 1) {
      s.al9ReminderDays = Math.min(30, Math.round(req.body.al9ReminderDays));
    }
    if (typeof req.body?.alertReminderDays === 'number' && req.body.alertReminderDays >= 1) {
      s.alertReminderDays = Math.min(30, Math.round(req.body.alertReminderDays));
    }
    if (typeof req.body?.maxFileSizeMb === 'number' && req.body.maxFileSizeMb >= 1) {
      s.maxFileSizeMb = Math.min(50, Math.round(req.body.maxFileSizeMb));
    }
    if (typeof req.body?.migrationModeEnabled === 'boolean') {
      s.migrationModeEnabled = req.body.migrationModeEnabled;
    }
    if (typeof req.body?.migrationEndsAt === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(req.body.migrationEndsAt)) {
      s.migrationEndsAt = req.body.migrationEndsAt;
    }
    if (req.body?.systemDateOverride === '' || req.body?.systemDateOverride === null) {
      s.systemDateOverride = undefined;
    } else if (
      typeof req.body?.systemDateOverride === 'string' &&
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(req.body.systemDateOverride)
    ) {
      s.systemDateOverride = req.body.systemDateOverride;
    }

    recordAdminAudit('SETTINGS_UPDATED', 'application', actor, 'Paramètres plateforme', JSON.stringify(s));
    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({
      settings: s,
      effectiveTodayISO: getCasablancaTodayISO(s.systemDateOverride),
    });
  });

  // AD9 Audit Journal + CSV export
  router.get('/audit', requireAuth, requireAdmin, (_req: AuthedReq, res: Response) => {
    res.json({ audit: store.adminAudit });
  });

  router.get('/audit/csv', requireAuth, requireAdmin, (_req: AuthedReq, res: Response) => {
    const header = 'Horodatage;Source;Type;Acteur;Cible;Détails\n';
    const esc = (v: string) => `"${(v || '').replace(/"/g, '""')}"`;
    const rows = store.adminAudit
      .map((a) =>
        [a.timestamp, a.source, a.eventType, a.actorName, a.targetSummary, a.details].map(esc).join(';')
      )
      .join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="journal-ad9.csv"');
    res.send('\uFEFF' + header + rows);
  });

  // §15 Reference Dataset Seeder
  router.post('/seed-cdc-reference', requireAuth, requireAdmin, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const chosenPass = typeof req.body?.demoPassword === 'string' ? req.body.demoPassword : undefined;
    if (chosenPass && chosenPass.trim().length > 0 && chosenPass.trim().length < 8) {
      res.status(400).json({ error: 'Le mot de passe des comptes de recette doit contenir au moins 8 caractères.' });
      return;
    }
    const result = seedCdcReferenceDataset(actor, chosenPass);
    broadcastSync();
    res.json(result);
  });

  return router;
}
