export type UserRole = 'administrateur' | 'directeur' | 'responsable' | 'responsable_achat';

export type AccountStatus = 'en_attente' | 'actif' | 'desactive';

export type Priority = 'critique' | 'haute' | 'moyenne' | 'basse';

export type PhaseKey =
  | 'feasibility'
  | 'budget_study'
  | 'validation'
  | 'orders'
  | 'planning'
  | 'control'
  | 'closing';

export type PhaseStatus = 'non_demarree' | 'en_cours' | 'terminee' | 'a_revoir';

export type TransitionMode = 'bloquant' | 'libre';

export type MultiDirectorRule = 'accord_de_tous' | 'un_seul_suffit';

export type ProjectStatus = 'actif' | 'suspendu' | 'annule' | 'clos';

export type TaskStatus = 'a_faire' | 'en_cours' | 'en_attente' | 'terminee' | 'annulee';

export type TaskExecutionMode = 'interne' | 'externe';

export type DependencyReaction = 'sans_impact' | 'decaler';

export type SupplierStatus = 'qualifie' | 'a_verifier' | 'inactif';

export type BudgetRevisionStatus = 'brouillon' | 'soumise' | 'validee' | 'a_revoir' | 'rejetee' | 'remplacee';

export type HolidayStatus = 'previsionnel' | 'confirme';

export type AlertCode =
  | 'AL1'
  | 'AL2'
  | 'AL3'
  | 'AL4'
  | 'AL5'
  | 'AL6'
  | 'AL7'
  | 'AL8'
  | 'AL9'
  | 'AL10'
  | 'AL11'
  | 'AL12'
  | 'AL13'
  | 'AL14';

export type AlertFamily = 'retards' | 'phases' | 'controle_cloture' | 'achats';

export type AppSection =
  | 'dashboard'
  | 'projects'
  | 'project_detail'
  | 'my_tasks'
  | 'decisions'
  | 'suppliers'
  | 'notifications'
  | 'admin';

export interface Department {
  id: string;
  name: string;
  code: string;
  active: boolean;
  createdAt: string;
}

export interface HolidayEntry {
  id: string;
  date: string; // YYYY-MM-DD
  label: string;
  status: HolidayStatus;
  year: number;
}

export interface WorkSchedulePeriod {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  type: 'arret' | 'horaires';
  hoursLabel?: string;
}

export interface WorkSchedule {
  id: string;
  name: string;
  workingDays: number[]; // 0=Sun..6=Sat
  applyHolidays: boolean;
  hoursInfo?: string;
  periods: WorkSchedulePeriod[];
  active: boolean;
  isDefault?: boolean;
}

export interface UserAccount {
  uid: string;
  username: string;
  displayName: string;
  email: string;
  role: UserRole;
  departmentId: string;
  departmentName: string;
  status: AccountStatus;
  failedAttempts: number;
  lockedUntil?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserDirectoryItem {
  uid: string;
  displayName: string;
  role: UserRole;
  departmentId: string;
  departmentName: string;
  status: AccountStatus;
}

export interface Delegation {
  id: string;
  delegatorId: string;
  delegatorName: string;
  delegateeId: string;
  delegateeName: string;
  role: UserRole;
  startDate: string;
  endDate: string;
  isSingleDirectorException: boolean;
  sponsorNote?: string;
  allowedActions: string[];
  active: boolean;
  createdBy: string;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  ice: string;
  domain: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  status: SupplierStatus;
  proposedById?: string;
  proposedByName?: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  entityType: 'project' | 'phase' | 'task' | 'intervention' | 'order' | 'invoice' | 'budget_line' | 'closing';
  entityId: string;
  projectId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
  previousVersionId?: string;
  uploadedById: string;
  uploadedByName: string;
  uploadedAt: string;
  removed: boolean;
  removedBy?: string;
  removedAt?: string;
  scanStatus: 'clean';
}

export interface PhaseStakeholder {
  uid: string;
  displayName: string;
  isLead: boolean;
}

export interface ValidationDecisionRecord {
  uid: string;
  displayName: string;
  decision: 'valide' | 'a_revoir' | 'rejete';
  comment: string;
  returnToPhase?: PhaseKey;
  decidedAt: string;
  byDelegationOf?: string;
}

export interface ClosingSignOff {
  uid: string;
  displayName: string;
  role: UserRole;
  signed: boolean;
  signedAt?: string;
  comment?: string;
  byDelegationOf?: string;
}

export interface ProjectPhase {
  key: PhaseKey;
  label: string;
  order: number;
  status: PhaseStatus;
  transitionFromPrev: TransitionMode;
  stakeholders: PhaseStakeholder[];
  startedAt?: string;
  completedAt?: string;
  notes?: string;
  decisions?: ValidationDecisionRecord[];
  closingSignOffs?: ClosingSignOff[];
  finalClosingSignOffs?: ClosingSignOff[];
  closedOutOfTool?: boolean;
}

export interface BaselineSnapshot {
  version: number;
  createdAt: string;
  createdBy: string;
  approvedBy?: string;
  reason: string;
  taskDates: Record<string, { startDate: string; endDate: string; duration: number }>;
}

export interface BaselineRequest {
  id: string;
  projectId: string;
  requestedById: string;
  requestedByName: string;
  requestedAt: string;
  reason: string;
  planningRevisionAtRequest: number;
  proposedDates: Record<string, { startDate: string; endDate: string }>;
  status: 'en_attente' | 'validee' | 'refusee' | 'perimee';
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
}

export interface Project {
  id: string;
  code: string;
  title: string;
  description: string;
  priority: Priority;
  status: ProjectStatus;
  responsable0Id: string;
  responsable0Name: string;
  createdById: string;
  createdByName: string;
  workScheduleId: string;
  currency: string;
  showAmountsToResponsable: boolean;
  multiDirectorRule: MultiDirectorRule;
  planningLaunched: boolean;
  planningLaunchedAt?: string;
  planningRevision: number;
  budgetRevision: number;
  targetStartDate: string;
  targetEndDate: string;
  phases: ProjectPhase[];
  baselines: BaselineSnapshot[];
  currentBaselineVersion: number;
  baselineRequests: BaselineRequest[];
  suspension?: {
    suspendedAt: string;
    suspendedBy: string;
    reasonCategory: string;
    reasonComment: string;
    plannedResumeDate?: string;
  };
  migration?: {
    isMigrated: boolean;
    migrationDate: string;
  };
  attachedSupplierIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskDependency {
  predecessorId: string;
  reaction: DependencyReaction;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  parentId: string | null;
  level: 1 | 2 | 3;
  code: string;
  title: string;
  description: string;
  priority: Priority;
  startDate: string;
  endDate: string;
  refStartDate?: string;
  refEndDate?: string;
  refV1StartDate?: string;
  refV1EndDate?: string;
  actualStartDate?: string;
  actualEndDate?: string;
  workScheduleId?: string;
  executionMode: TaskExecutionMode;
  departmentId: string;
  departmentName: string;
  assigneeId: string;
  assigneeName: string;
  coPilotIds?: string[];
  coPilotNames?: string[];
  supplierId?: string;
  supplierName?: string;
  supplierPendingApproval?: boolean;
  dependencies: TaskDependency[];
  progress: number; // 0..100 step 5
  status: TaskStatus;
  waitReason?: string;
  cancelReason?: string;
  delayJustification?: string;
  calendarConflict?: {
    detectedAt: string;
    reason: string;
  };
  controlStatus?: 'en_attente' | 'validee' | 'refusee';
  controlNote?: string;
  controlBy?: string;
  controlAt?: string;
  isMigration?: boolean;
  frozenEr?: number | null;
  frozenErRef?: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Intervention {
  id: string;
  code: string; // INT-AAAA-NNN
  parentId: string | null;
  title: string;
  description: string;
  priority: Priority;
  location: string;
  requesterName: string;
  startDate: string;
  endDate: string;
  actualStartDate?: string;
  actualEndDate?: string;
  workScheduleId: string;
  executionMode: TaskExecutionMode;
  departmentId: string;
  departmentName: string;
  assigneeId: string;
  assigneeName: string;
  supplierId?: string;
  supplierName?: string;
  supplierPendingApproval?: boolean;
  progress: number;
  status: TaskStatus;
  waitReason?: string;
  cancelReason?: string;
  delayJustification?: string;
  frozenEr?: number | null;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetLine {
  id: string;
  category: string;
  designation: string;
  plannedAmount: number;
  settled: boolean;
}

export interface BudgetRevision {
  id: string;
  projectId: string;
  version: number;
  status: BudgetRevisionStatus;
  reason: string;
  lines: BudgetLine[];
  requestedById: string;
  requestedByName: string;
  requestedAt: string;
  decidedById?: string;
  decidedByName?: string;
  decidedAt?: string;
  decisionComment?: string;
  byDelegationOf?: string;
  fromMigration?: boolean;
}

export interface PurchaseOrder {
  id: string;
  projectId: string;
  budgetLineId: string;
  number: string;
  issueDate: string;
  supplierId: string;
  supplierName: string;
  amountHT: number;
  vatRate: 0 | 7 | 10 | 14 | 20;
  vatAmount: number;
  amountTTC: number;
  currency: string;
  originalCurrency?: string;
  originalAmountHT?: number;
  exchangeRate?: number;
  exchangeRateDate?: string;
  attachmentId: string;
  status: 'actif' | 'annule';
  cancelReason?: string;
  exceedReason?: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
}

export interface InvoiceRecord {
  id: string;
  projectId: string;
  orderId: string;
  budgetLineId: string;
  type: 'facture' | 'avoir';
  number: string;
  issueDate: string;
  originalCurrency: string;
  originalAmountHT: number;
  vatAmount: number;
  amountTTC: number;
  exchangeRate: number;
  exchangeRateDate: string;
  convertedAmountHT: number;
  attachmentId: string;
  exceedReason?: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  code: AlertCode;
  family: AlertFamily;
  recipientId: string;
  projectId?: string;
  entityId: string;
  occurrenceKey: string;
  title: string;
  message: string;
  read: boolean;
  closed: boolean;
  createdAt: string;
  lastRemindedAt?: string;
}

export interface BusinessHistoryEntry {
  id: string;
  projectId?: string;
  entityType: string;
  entityId: string;
  actorId: string;
  actorName: string;
  onBehalfOf?: string;
  action: string;
  beforeValue?: string;
  afterValue?: string;
  reason?: string;
  timestamp: string;
}

export interface AdminAuditEntry {
  id: string;
  eventType: string;
  source: 'identite' | 'application';
  actorId: string;
  actorName: string;
  targetSummary: string;
  details: string;
  timestamp: string;
}

export interface PlatformSettings {
  defaultCurrency: string;
  availableCurrencies: string[];
  al1ThresholdPoints: number;
  al9ReminderDays: number;
  alertReminderDays: number;
  maxFileSizeMb: number;
  allowedExtensions: string[];
  migrationModeEnabled: boolean;
  migrationEndsAt: string;
  systemDateOverride?: string; // Optional YYYY-MM-DD for §15 acceptance testing (2026-10-21)
}

export interface ComputedTaskMetrics {
  durationWorked: number;
  durationCalendar: number;
  theoreticalProgress: number;
  effectiveStart: string;
  er: number | null;
  erRef: number | null;
  ec: number | null;
  ecRef: number | null;
  ep: number | null;
  epRef: number | null;
  projectedEndDate: string | null;
  displayVariance: number | null;
  displayVarianceOfficial: number | null;
  varianceStatus: 'avance' | 'a_lheure' | 'retard_projete' | 'depasse' | 'non_demarree' | 'neutre';
  varianceLabel: string;
  isLate: boolean;
  hasConflict: boolean;
  conflictPredecessorIds: string[];
  delayedLeavesCount: number;
}

export const PHASE_CATALOG: { key: PhaseKey; order: number; label: string; eligibleRoles: UserRole[] }[] = [
  { key: 'feasibility', order: 1, label: 'Étude de faisabilité', eligibleRoles: ['responsable', 'responsable_achat'] },
  { key: 'budget_study', order: 2, label: 'Étude budgétaire', eligibleRoles: ['responsable_achat'] },
  { key: 'validation', order: 3, label: 'Validation', eligibleRoles: ['directeur'] },
  { key: 'orders', order: 4, label: 'Commandes', eligibleRoles: ['responsable_achat'] },
  { key: 'planning', order: 5, label: 'Planification', eligibleRoles: ['responsable', 'responsable_achat'] },
  { key: 'control', order: 6, label: 'Contrôle', eligibleRoles: ['responsable', 'responsable_achat'] },
  { key: 'closing', order: 7, label: 'Clôture', eligibleRoles: ['responsable', 'responsable_achat', 'directeur'] },
];

export const ROLE_LABELS: Record<UserRole, string> = {
  administrateur: 'Administrateur',
  directeur: 'Directeur',
  responsable: 'Responsable',
  responsable_achat: 'Responsable achat',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  critique: 'Critique',
  haute: 'Haute',
  moyenne: 'Moyenne',
  basse: 'Basse',
};

export const PRIORITY_ORDER: Record<Priority, number> = {
  critique: 4,
  haute: 3,
  moyenne: 2,
  basse: 1,
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  en_attente: 'En attente',
  terminee: 'Terminée',
  annulee: 'Annulée',
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  actif: 'Actif',
  suspendu: 'Suspendu',
  annule: 'Annulé',
  clos: 'Clos',
};

export const PHASE_STATUS_LABELS: Record<PhaseStatus, string> = {
  non_demarree: 'Non démarrée',
  en_cours: 'En cours',
  terminee: 'Terminée',
  a_revoir: 'À revoir',
};
