import {
  computeProjectTree,
  getCasablancaTodayISO,
} from '../src/shared/calculationEngine.ts';
import type {
  AlertCode,
  AlertFamily,
  BudgetRevision,
  InvoiceRecord,
  NotificationItem,
  Project,
  PurchaseOrder,
  UserRole,
} from '../src/shared/types.ts';
import { makeId, store } from './store.ts';

function alertFamilyForCode(code: AlertCode): AlertFamily {
  if (code === 'AL1' || code === 'AL2' || code === 'AL5' || code === 'AL14') return 'retards';
  if (code === 'AL3' || code === 'AL4' || code === 'AL8' || code === 'AL12') return 'phases';
  if (code === 'AL9' || code === 'AL10' || code === 'AL11') return 'controle_cloture';
  return 'achats';
}

function resolveRecipientsWithDelegation(recipientIds: string[], todayISO: string): string[] {
  const result = new Set<string>();
  for (const uid of recipientIds) {
    if (!uid) continue;
    const activeUser = store.users.find((u) => u.uid === uid && u.status === 'actif');
    if (activeUser) result.add(uid);
    // Also route to any active delegatee covering this delegator today
    for (const del of store.delegations) {
      if (
        del.active &&
        del.delegatorId === uid &&
        todayISO >= del.startDate &&
        todayISO <= del.endDate
      ) {
        const delUser = store.users.find((u) => u.uid === del.delegateeId && u.status === 'actif');
        if (delUser) result.add(delUser.uid);
      }
    }
  }
  return Array.from(result);
}

interface DesiredAlert {
  code: AlertCode;
  recipientId: string;
  projectId?: string;
  entityId: string;
  occurrenceKey: string;
  title: string;
  message: string;
}

export function evaluateAllAlerts(): void {
  const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
  const desired: DesiredAlert[] = [];
  const threshold = store.settings.al1ThresholdPoints || 10;

  const pushAlert = (
    code: AlertCode,
    rawRecipients: string[],
    projectId: string | undefined,
    entityId: string,
    occurrenceKey: string,
    title: string,
    message: string
  ) => {
    const recipients = resolveRecipientsWithDelegation(rawRecipients, todayISO);
    for (const recipientId of recipients) {
      desired.push({
        code,
        recipientId,
        projectId,
        entityId,
        occurrenceKey,
        title,
        message,
      });
    }
  };

  const directorIds = store.users
    .filter((u) => u.role === 'directeur' && u.status === 'actif')
    .map((u) => u.uid);
  const purchasingIds = store.users
    .filter((u) => u.role === 'responsable_achat' && u.status === 'actif')
    .map((u) => u.uid);

  for (const project of store.projects) {
    if (project.status === 'annule' || project.status === 'clos') continue;

    const projectTasks = store.tasks.filter((t) => t.projectId === project.id);
    const tree = computeProjectTree(
      project,
      projectTasks,
      store.workSchedules,
      store.holidays,
      todayISO
    );

    const planningPhase = project.phases.find((p) => p.key === 'planning');
    const planningLeadIds = planningPhase?.stakeholders.filter((s) => s.isLead).map((s) => s.uid) || [];

    // AL1, AL2, AL5, AL14 on active leaves
    for (const task of projectTasks) {
      const hasChildren = projectTasks.some((t) => t.parentId === task.id);
      if (hasChildren || task.status === 'annulee' || task.status === 'terminee') continue;
      const m = tree.metricsById[task.id];
      if (!m) continue;

      const taskPilotIds = [task.assigneeId, ...(task.coPilotIds || [])];

      if (m.isLate || m.theoreticalProgress - task.progress >= threshold) {
        pushAlert(
          'AL1',
          [project.responsable0Id, ...taskPilotIds],
          project.id,
          task.id,
          `al1_${task.id}_${m.varianceLabel}`,
          `[${project.code}] Retard détecté · ${task.code}`,
          `Tâche « ${task.title} » (${task.code}) : R=${task.progress}%, Th=${m.theoreticalProgress}%, ${m.varianceLabel}.`
        );
      }

      if (m.hasConflict) {
        pushAlert(
          'AL5',
          [project.responsable0Id, ...planningLeadIds, ...taskPilotIds],
          project.id,
          task.id,
          `al5_${task.id}_${m.conflictPredecessorIds.join(',')}`,
          `[${project.code}] Conflit de dépendance · ${task.code}`,
          `Un prédécesseur empiète sur les dates de la tâche « ${task.title} » (mode Sans impact).`
        );
      }

      if (task.calendarConflict) {
        pushAlert(
          'AL14',
          [project.responsable0Id, ...planningLeadIds, ...taskPilotIds],
          project.id,
          task.id,
          `al14_${task.id}_${task.calendarConflict.detectedAt}`,
          `[${project.code}] Conflit calendrier · ${task.code}`,
          `La tâche « ${task.title} » comporte des jours non ouvrés suite à une mise à jour du calendrier.`
        );
      }

      if (task.controlStatus === 'refusee') {
        pushAlert(
          'AL10',
          [...taskPilotIds, project.responsable0Id],
          project.id,
          task.id,
          `al10_${task.id}_${task.controlAt || ''}`,
          `[${project.code}] Contrôle refusé · ${task.code}`,
          `La tâche « ${task.title} » a été refusée au contrôle : ${task.controlNote || 'Réouverture requise'}.`
        );
      }
    }

    // AL3: Validation pending
    const valPhase = project.phases.find((p) => p.key === 'validation');
    if (valPhase && valPhase.status === 'en_cours') {
      const pendingDirs = valPhase.stakeholders
        .filter((s) => !valPhase.decisions?.some((d) => d.uid === s.uid && d.decision === 'valide'))
        .map((s) => s.uid);
      pushAlert(
        'AL3',
        pendingDirs.length > 0 ? pendingDirs : directorIds,
        project.id,
        project.id,
        `al3_${project.id}_val`,
        `[${project.code}] Validation Direction en attente`,
        `Le projet « ${project.title} » attend la décision de la Direction.`
      );
    }

    // AL4: Phase à revoir
    for (const ph of project.phases) {
      if (ph.status === 'a_revoir') {
        const leads = ph.stakeholders.filter((s) => s.isLead).map((s) => s.uid);
        pushAlert(
          'AL4',
          [project.responsable0Id, ...leads],
          project.id,
          `${project.id}_${ph.key}`,
          `al4_${project.id}_${ph.key}`,
          `[${project.code}] Phase « ${ph.label} » à revoir`,
          `La phase « ${ph.label} » nécessite une reprise avant nouvelle validation.`
        );
      }
    }

    // AL7: Budget revision submitted
    const pendingRevs = store.budgetRevisions.filter(
      (b) => b.projectId === project.id && b.status === 'soumise'
    );
    for (const rev of pendingRevs) {
      pushAlert(
        'AL7',
        directorIds,
        project.id,
        rev.id,
        `al7_${rev.id}`,
        `[${project.code}] Révision budgétaire V${rev.version} soumise`,
        `Une proposition budgétaire V${rev.version} attend la validation Direction.`
      );
    }

    // AL6: Budget >= 90% or exceeded
    const activeBud = store.budgetRevisions.find(
      (b) => b.projectId === project.id && b.status === 'validee'
    );
    if (activeBud) {
      const plannedTotal = activeBud.lines.reduce((s, l) => s + l.plannedAmount, 0);
      const engagedTotal = store.purchaseOrders
        .filter((po) => po.projectId === project.id && po.status === 'actif')
        .reduce((s, po) => s + po.amountHT, 0);
      if (plannedTotal > 0 && engagedTotal / plannedTotal >= 0.9) {
        const pct = Math.round((engagedTotal / plannedTotal) * 100);
        const ordersLeads =
          project.phases
            .find((p) => p.key === 'orders')
            ?.stakeholders.map((s) => s.uid) || purchasingIds;
        pushAlert(
          'AL6',
          [project.responsable0Id, ...directorIds, ...ordersLeads],
          project.id,
          project.id,
          `al6_${project.id}_${pct >= 100 ? 'over' : '90'}`,
          `[${project.code}] Seuil budgétaire (${pct}%)`,
          `L'engagement HT atteint ${pct}% du budget validé sur « ${project.title} ».`
        );
      }
    }

    // AL9: Control phase open
    const ctrlPhase = project.phases.find((p) => p.key === 'control');
    if (ctrlPhase && ctrlPhase.status === 'en_cours') {
      pushAlert(
        'AL9',
        [project.responsable0Id],
        project.id,
        `${project.id}_control`,
        `al9_${project.id}`,
        `[${project.code}] Phase Contrôle ouverte`,
        `Toutes les tâches sont achevées ou annulées. Le contrôle par ${project.responsable0Name} est attendu.`
      );
    }

    // AL11: Closing phase open
    const closePhase = project.phases.find((p) => p.key === 'closing');
    if (closePhase && closePhase.status === 'en_cours') {
      const unsigned = (closePhase.closingSignOffs || [])
        .filter((s) => !s.signed)
        .map((s) => s.uid);
      pushAlert(
        'AL11',
        unsigned.length > 0 ? unsigned : [project.responsable0Id],
        project.id,
        `${project.id}_closing`,
        `al11_${project.id}`,
        `[${project.code}] Phase Clôture en attente`,
        `La clôture du projet « ${project.title} » attend les signatures restantes.`
      );
    }

    // AL12: Suspended project
    if (project.status === 'suspendu' && project.suspension) {
      const leadIds = project.phases.flatMap((p) => p.stakeholders.map((s) => s.uid));
      pushAlert(
        'AL12',
        [project.responsable0Id, ...directorIds, ...leadIds],
        project.id,
        `${project.id}_susp`,
        `al12_${project.id}_${project.suspension.suspendedAt}`,
        `[${project.code}] Projet suspendu`,
        `Le projet « ${project.title} » est suspendu (${project.suspension.reasonCategory}).`
      );
    }
  }

  // AL13: Proposed suppliers awaiting verification
  const pendingSuppliers = store.suppliers.filter((s) => s.status === 'a_verifier');
  for (const sup of pendingSuppliers) {
    pushAlert(
      'AL13',
      purchasingIds,
      undefined,
      sup.id,
      `al13_${sup.id}`,
      `Prestataire à vérifier : ${sup.name}`,
      `Proposé par ${sup.proposedByName || 'Responsable'} (ICE : ${sup.ice}). Validation achats requise.`
    );
  }

  // Sync desired alerts into store.notifications (dedup by code+recipient+occurrenceKey)
  const desiredKeys = new Set<string>();
  const now = new Date().toISOString();

  for (const d of desired) {
    const key = `${d.code}::${d.recipientId}::${d.occurrenceKey}`;
    desiredKeys.add(key);
    const existing = store.notifications.find(
      (n) => `${n.code}::${n.recipientId}::${n.occurrenceKey}` === key
    );
    if (!existing) {
      const item: NotificationItem = {
        id: makeId('notif'),
        code: d.code,
        family: alertFamilyForCode(d.code),
        recipientId: d.recipientId,
        projectId: d.projectId,
        entityId: d.entityId,
        occurrenceKey: d.occurrenceKey,
        title: d.title,
        message: d.message,
        read: false,
        closed: false,
        createdAt: now,
      };
      store.notifications.unshift(item);
    } else if (existing.closed) {
      existing.closed = false;
      existing.title = d.title;
      existing.message = d.message;
    }
  }

  // Close notifications that are no longer active (except AL10/AL12 historical info kept until read)
  for (const n of store.notifications) {
    const key = `${n.code}::${n.recipientId}::${n.occurrenceKey}`;
    if (!desiredKeys.has(key) && !n.closed) {
      n.closed = true;
    }
  }

  if (store.notifications.length > 2000) {
    store.notifications.length = 2000;
  }
}

export function createImmediateAlert(params: {
  code: AlertCode;
  recipientIds: string[];
  projectId?: string;
  entityId: string;
  occurrenceKey: string;
  title: string;
  message: string;
}): void {
  const todayISO = getCasablancaTodayISO(store.settings.systemDateOverride);
  const recipients = resolveRecipientsWithDelegation(params.recipientIds, todayISO);
  const now = new Date().toISOString();
  for (const recipientId of recipients) {
    const exists = store.notifications.find(
      (n) =>
        n.code === params.code &&
        n.recipientId === recipientId &&
        n.occurrenceKey === params.occurrenceKey
    );
    if (!exists) {
      store.notifications.unshift({
        id: makeId('notif'),
        code: params.code,
        family: alertFamilyForCode(params.code),
        recipientId,
        projectId: params.projectId,
        entityId: params.entityId,
        occurrenceKey: params.occurrenceKey,
        title: params.title,
        message: params.message,
        read: false,
        closed: false,
        createdAt: now,
      });
    }
  }
}

/**
 * §2.4 Confidentialité financière :
 * Si showAmountsToResponsable === false, masquer TOUS les montants sur les réponses API/WebSocket
 * destinées à un utilisateur de rôle 'responsable' (y compris sans délégation achat/direction).
 */
export function sanitizeBudgetRevisionsForUser(
  revisions: BudgetRevision[],
  projects: Project[],
  role: UserRole
): BudgetRevision[] {
  if (role !== 'responsable') return revisions;
  const visibilityMap = new Map(projects.map((p) => [p.id, p.showAmountsToResponsable]));
  return revisions.map((rev) => {
    if (visibilityMap.get(rev.projectId)) return rev;
    return {
      ...rev,
      lines: rev.lines.map((l) => ({
        ...l,
        plannedAmount: 0,
      })),
    };
  });
}

export function sanitizeOrdersForUser(
  orders: PurchaseOrder[],
  projects: Project[],
  role: UserRole
): PurchaseOrder[] {
  if (role !== 'responsable') return orders;
  const visibilityMap = new Map(projects.map((p) => [p.id, p.showAmountsToResponsable]));
  return orders.map((po) => {
    if (visibilityMap.get(po.projectId)) return po;
    return {
      ...po,
      amountHT: 0,
      vatAmount: 0,
      amountTTC: 0,
      originalAmountHT: undefined,
      exchangeRate: undefined,
    };
  });
}

export function sanitizeInvoicesForUser(
  invoices: InvoiceRecord[],
  projects: Project[],
  role: UserRole
): InvoiceRecord[] {
  if (role !== 'responsable') return invoices;
  const visibilityMap = new Map(projects.map((p) => [p.id, p.showAmountsToResponsable]));
  return invoices.map((inv) => {
    if (visibilityMap.get(inv.projectId)) return inv;
    return {
      ...inv,
      originalAmountHT: 0,
      vatAmount: 0,
      amountTTC: 0,
      exchangeRate: 0,
      convertedAmountHT: 0,
    };
  });
}
