import express, { type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  getCasablancaTodayISO,
  signedVarianceDays,
} from '../src/shared/calculationEngine.ts';
import type {
  Attachment,
  Intervention,
  Priority,
  TaskExecutionMode,
  UserDirectoryItem,
} from '../src/shared/types.ts';
import {
  evaluateAllAlerts,
  sanitizeBudgetRevisionsForUser,
  sanitizeInvoicesForUser,
  sanitizeOrdersForUser,
} from './alertsEngine.ts';
import { type AuthedReq, denyAdminContent } from './routesProjects.ts';
import {
  UPLOADS_DIR,
  cleanString,
  makeId,
  recordBusinessHistory,
  saveStore,
  store,
  stripUserSecrets,
  type StoredUser,
} from './store.ts';

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
};

function verifyMagicBytes(ext: string, buf: Buffer): boolean {
  if (buf.length < 4) return false;
  if (ext === 'pdf') return buf.subarray(0, 4).toString('ascii') === '%PDF';
  if (ext === 'png') return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (ext === 'jpg' || ext === 'jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (ext === 'docx' || ext === 'xlsx') return buf[0] === 0x50 && buf[1] === 0x4b; // ZIP PK header
  if (ext === 'heic') return buf.includes(Buffer.from('ftyp'));
  return false;
}

export function buildWorkspaceSnapshot(user: StoredUser) {
  const effectiveTodayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
  const directory: UserDirectoryItem[] = store.users.map((u) => ({
    uid: u.uid,
    displayName: u.displayName,
    role: u.role,
    departmentId: u.departmentId,
    departmentName: u.departmentName,
    status: u.status,
  }));

  // §2.1 & §10.3: Administrateur NEVER receives project, task, intervention, supplier, or budget content
  if (user.role === 'administrateur') {
    return {
      currentUser: stripUserSecrets(user),
      effectiveTodayISO,
      settings: store.settings,
      departments: store.departments,
      holidays: store.holidays,
      workSchedules: store.workSchedules,
      delegations: store.delegations,
      users: store.users.map(stripUserSecrets),
      directory,
      adminAudit: store.adminAudit,
      suppliers: [],
      projects: [],
      tasks: [],
      interventions: [],
      budgetRevisions: [],
      purchaseOrders: [],
      invoices: [],
      attachments: [],
      notifications: [],
      businessHistory: [],
    };
  }

  return {
    currentUser: stripUserSecrets(user),
    effectiveTodayISO,
    settings: store.settings,
    departments: store.departments,
    holidays: store.holidays,
    workSchedules: store.workSchedules,
    delegations: store.delegations.filter(
      (d) => user.role === 'directeur' || d.delegatorId === user.uid || d.delegateeId === user.uid
    ),
    users: [],
    directory,
    adminAudit: [],
    suppliers: store.suppliers,
    projects: store.projects,
    tasks: store.tasks,
    interventions: store.interventions,
    budgetRevisions: sanitizeBudgetRevisionsForUser(store.budgetRevisions, store.projects, user.role),
    purchaseOrders: sanitizeOrdersForUser(store.purchaseOrders, store.projects, user.role),
    invoices: sanitizeInvoicesForUser(store.invoices, store.projects, user.role),
    attachments: store.attachments.filter((a) => !a.removed),
    notifications: store.notifications.filter((n) => n.recipientId === user.uid && !n.closed),
    businessHistory: store.businessHistory,
  };
}

export function createInterventionsAndFilesRouter(
  requireAuth: express.RequestHandler,
  broadcastSync: () => void
): express.Router {
  const router = express.Router();

  // -------------------------------------------------------------------------
  // M3: Interventions (INT-AAAA-NNN, max 2 levels)
  // -------------------------------------------------------------------------
  router.post('/interventions', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const title = cleanString(req.body?.title, 160);
    const startDate = cleanString(req.body?.startDate, 10) || todayISO;
    const endDate = cleanString(req.body?.endDate, 10) || todayISO;
    const assigneeId = cleanString(req.body?.assigneeId || actor.uid, 80);
    const parentId = cleanString(req.body?.parentId || '', 80) || null;

    if (!title || endDate < startDate) {
      res.status(400).json({ error: 'Titre et dates valides obligatoires.' });
      return;
    }
    if (parentId) {
      const parent = store.interventions.find((i) => i.id === parentId);
      if (!parent || parent.parentId !== null) {
        res.status(400).json({ error: 'Les interventions sont limitées à 2 niveaux maximum.' });
        return;
      }
    }

    const assignee = store.users.find((u) => u.uid === assigneeId && u.status === 'actif');
    if (!assignee) {
      res.status(400).json({ error: 'Intervenant introuvable.' });
      return;
    }

    const year = todayISO.slice(0, 4);
    const topCount = store.interventions.filter((i) => i.parentId === null).length;
    const code = parentId
      ? `${store.interventions.find((i) => i.id === parentId)?.code || 'INT'}.${store.interventions.filter((i) => i.parentId === parentId).length + 1}`
      : `INT-${year}-${String(topCount + 1).padStart(3, '0')}`;

    const executionMode: TaskExecutionMode = req.body?.executionMode === 'externe' ? 'externe' : 'interne';
    const supplierId = executionMode === 'externe' ? cleanString(req.body?.supplierId || '', 80) || undefined : undefined;
    const sup = supplierId ? store.suppliers.find((s) => s.id === supplierId) : undefined;

    const now = new Date().toISOString();
    const item: Intervention = {
      id: makeId('int'),
      code,
      parentId,
      title,
      description: cleanString(req.body?.description || '', 1000),
      priority: (req.body?.priority as Priority) || 'moyenne',
      location: cleanString(req.body?.location || '', 120),
      requesterName: cleanString(req.body?.requesterName || actor.displayName, 100),
      startDate,
      endDate,
      workScheduleId: cleanString(req.body?.workScheduleId || '', 80) || store.workSchedules[0]?.id || 'sched_ouvres',
      executionMode,
      departmentId: assignee.departmentId,
      departmentName: assignee.departmentName,
      assigneeId: assignee.uid,
      assigneeName: assignee.displayName,
      supplierId: sup?.id,
      supplierName: sup?.name,
      supplierPendingApproval: sup?.status === 'a_verifier' ? true : undefined,
      progress: 0,
      status: 'a_faire',
      createdById: actor.uid,
      createdByName: actor.displayName,
      createdAt: now,
      updatedAt: now,
    };

    store.interventions.unshift(item);
    recordBusinessHistory({
      entityType: 'intervention',
      entityId: item.id,
      actor,
      action: `Création intervention ${item.code}`,
      afterValue: item.title,
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.status(201).json({ intervention: item });
  });

  router.post('/interventions/:id/action', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
    const item = store.interventions.find((i) => i.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Intervention introuvable.' });
      return;
    }
    if (item.assigneeId !== actor.uid && item.createdById !== actor.uid && actor.role !== 'directeur') {
      res.status(403).json({ error: 'Permission refusée.' });
      return;
    }

    const action = req.body?.action as string;
    if (action === 'start') {
      item.status = 'en_cours';
      item.actualStartDate = item.actualStartDate || todayISO;
      item.waitReason = undefined;
    } else if (action === 'progress') {
      const p = Number(req.body?.progress);
      if (Number.isNaN(p) || p < 0 || p > 95 || p % 5 !== 0) {
        res.status(400).json({ error: 'Avancement multiple de 5% entre 0% et 95%.' });
        return;
      }
      if (item.status === 'a_faire') {
        item.status = 'en_cours';
        item.actualStartDate = item.actualStartDate || todayISO;
      }
      item.progress = p;
      item.waitReason = undefined;
    } else if (action === 'wait') {
      const reason = cleanString(req.body?.reason || '', 500);
      if (!reason) {
        res.status(400).json({ error: 'Motif requis.' });
        return;
      }
      item.status = 'en_attente';
      item.waitReason = reason;
    } else if (action === 'complete') {
      const sched = store.workSchedules.find((s) => s.id === item.workScheduleId) || store.workSchedules[0];
      const er = signedVarianceDays(todayISO, item.endDate, sched, store.holidays);
      const justif = cleanString(req.body?.delayJustification || '', 1000);
      if (er < 0 && justif.length < 20) {
        res.status(400).json({ error: `Justification >= 20 caractères obligatoire en cas de retard (${er} j).` });
        return;
      }
      item.status = 'terminee';
      item.progress = 100;
      item.actualStartDate = item.actualStartDate || todayISO;
      item.actualEndDate = todayISO;
      item.frozenEr = er;
      item.delayJustification = justif || undefined;
    } else if (action === 'cancel') {
      const reason = cleanString(req.body?.reason || '', 500);
      if (!reason) {
        res.status(400).json({ error: 'Motif d’annulation obligatoire.' });
        return;
      }
      item.status = 'annulee';
      item.progress = 0;
      item.cancelReason = reason;
    } else {
      res.status(400).json({ error: 'Action inconnue.' });
      return;
    }

    item.updatedAt = new Date().toISOString();
    recordBusinessHistory({
      entityType: 'intervention',
      entityId: item.id,
      actor,
      action: `Intervention ${item.code} : ${action}`,
      afterValue: `${item.status} (${item.progress}%)`,
    });

    evaluateAllAlerts();
    saveStore();
    broadcastSync();
    res.json({ intervention: item });
  });

  // -------------------------------------------------------------------------
  // M8: Notifications
  // -------------------------------------------------------------------------
  router.post('/notifications/:id/read', requireAuth, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const n = store.notifications.find((x) => x.id === req.params.id && x.recipientId === actor.uid);
    if (n) {
      n.read = true;
      saveStore();
    }
    res.json({ ok: true });
  });

  router.post('/notifications/read-all', requireAuth, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    for (const n of store.notifications) {
      if (n.recipientId === actor.uid) n.read = true;
    }
    saveStore();
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // M8: Controlled Attachments Upload / Download / Versioning / Removal
  // -------------------------------------------------------------------------
  router.post('/attachments', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const fileName = cleanString(req.body?.fileName || '', 180);
    const contentBase64 = typeof req.body?.contentBase64 === 'string' ? req.body.contentBase64 : '';
    const entityType = req.body?.entityType as Attachment['entityType'];
    const entityId = cleanString(req.body?.entityId || '', 80);
    const projectId = cleanString(req.body?.projectId || '', 80);
    const previousVersionId = cleanString(req.body?.previousVersionId || '', 80) || undefined;

    if (!fileName || !contentBase64 || !entityType || !entityId) {
      res.status(400).json({ error: 'Fichier, type et entité de rattachement requis.' });
      return;
    }

    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const allowed = store.settings.allowedExtensions || ['pdf', 'docx', 'xlsx', 'jpg', 'jpeg', 'png', 'heic'];
    if (!allowed.includes(ext)) {
      res.status(400).json({ error: `Extension non autorisée (.${ext}). Autorisées : ${allowed.join(', ').toUpperCase()}.` });
      return;
    }

    const pureBase64 = contentBase64.includes(',') ? contentBase64.split(',').pop()! : contentBase64;
    const buf = Buffer.from(pureBase64, 'base64');
    const maxBytes = (store.settings.maxFileSizeMb || 20) * 1024 * 1024;
    if (buf.length === 0 || buf.length > maxBytes) {
      res.status(400).json({ error: `Taille invalide (max ${store.settings.maxFileSizeMb} Mo).` });
      return;
    }

    if (!verifyMagicBytes(ext, buf)) {
      res.status(400).json({ error: `Contenu du fichier incohérent avec l'extension .${ext} (contrôle de sécurité).` });
      return;
    }

    const id = makeId('att');
    const prev = previousVersionId ? store.attachments.find((a) => a.id === previousVersionId) : undefined;
    const version = prev ? prev.version + 1 : 1;

    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.resolve(UPLOADS_DIR, `${id}.${ext}`), buf);

    const attachment: Attachment = {
      id,
      entityType,
      entityId,
      projectId,
      fileName: path.basename(fileName),
      mimeType: MIME_BY_EXT[ext] || 'application/octet-stream',
      sizeBytes: buf.length,
      version,
      previousVersionId,
      uploadedById: actor.uid,
      uploadedByName: actor.displayName,
      uploadedAt: new Date().toISOString(),
      removed: false,
      scanStatus: 'clean',
    };

    store.attachments.unshift(attachment);
    recordBusinessHistory({
      projectId: projectId || undefined,
      entityType: 'attachment',
      entityId: attachment.id,
      actor,
      action: `Ajout pièce jointe (${attachment.fileName} v${attachment.version})`,
    });

    saveStore();
    broadcastSync();
    res.status(201).json({ attachment });
  });

  router.get('/attachments/:id/download', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const att = store.attachments.find((a) => a.id === req.params.id && !a.removed);
    if (!att) {
      res.status(404).json({ error: 'Pièce jointe introuvable.' });
      return;
    }
    const ext = att.fileName.split('.').pop()?.toLowerCase() || 'pdf';
    const filePath = path.resolve(UPLOADS_DIR, `${att.id}.${ext}`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Fichier physique absent.' });
      return;
    }
    res.setHeader('Content-Type', att.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${att.fileName.replace(/"/g, '')}"`);
    res.sendFile(filePath);
  });

  router.delete('/attachments/:id', requireAuth, denyAdminContent, (req: AuthedReq, res: Response) => {
    const actor = req.currentUser!;
    const att = store.attachments.find((a) => a.id === req.params.id && !a.removed);
    if (!att) {
      res.status(404).json({ error: 'Pièce jointe introuvable.' });
      return;
    }
    if (att.uploadedById !== actor.uid && actor.role !== 'directeur') {
      res.status(403).json({ error: 'Seul l’auteur ou la Direction peut retirer ce fichier.' });
      return;
    }
    att.removed = true;
    att.removedBy = actor.displayName;
    att.removedAt = new Date().toISOString();
    recordBusinessHistory({
      projectId: att.projectId || undefined,
      entityType: 'attachment',
      entityId: att.id,
      actor,
      action: `Retrait pièce jointe (${att.fileName})`,
    });
    saveStore();
    broadcastSync();
    res.json({ ok: true });
  });

  // Workspace snapshot endpoint
  router.get('/workspace', requireAuth, (req: AuthedReq, res: Response) => {
    evaluateAllAlerts();
    res.json(buildWorkspaceSnapshot(req.currentUser!));
  });

  return router;
}
