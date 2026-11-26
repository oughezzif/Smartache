import type {
  AdminAuditEntry,
  Attachment,
  BudgetRevision,
  BusinessHistoryEntry,
  Delegation,
  Department,
  HolidayEntry,
  Intervention,
  NotificationItem,
  PhaseKey,
  PlatformSettings,
  Priority,
  Project,
  ProjectTask,
  PurchaseOrder,
  InvoiceRecord,
  Supplier,
  TaskDependency,
  TaskExecutionMode,
  TransitionMode,
  UserAccount,
  UserDirectoryItem,
  UserRole,
  WorkSchedule,
} from '../shared/types';

export interface WorkspaceSnapshot {
  currentUser: UserAccount;
  effectiveTodayISO: string;
  settings: PlatformSettings;
  departments: Department[];
  holidays: HolidayEntry[];
  workSchedules: WorkSchedule[];
  delegations: Delegation[];
  users: UserAccount[];
  directory: UserDirectoryItem[];
  adminAudit: AdminAuditEntry[];
  suppliers: Supplier[];
  projects: Project[];
  tasks: ProjectTask[];
  interventions: Intervention[];
  budgetRevisions: BudgetRevision[];
  purchaseOrders: PurchaseOrder[];
  invoices: InvoiceRecord[];
  attachments: Attachment[];
  notifications: NotificationItem[];
  businessHistory: BusinessHistoryEntry[];
}

export interface AuthStatusResponse {
  hasAdmin: boolean;
  totalUsers: number;
  envPasscodeConfigured: boolean;
}

let memoryToken = '';
let onUnauthorizedCallback: (() => void) | null = null;

export function setAuthToken(token: string): void {
  memoryToken = token;
}

export function getAuthToken(): string {
  return memoryToken;
}

export function clearAuthToken(): void {
  memoryToken = '';
}

export function setOnUnauthorized(cb: () => void): void {
  onUnauthorizedCallback = cb;
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401 && memoryToken) {
    memoryToken = '';
    onUnauthorizedCallback?.();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Erreur serveur (${res.status})`);
  }
  return data as T;
}

export const api = {
  // Auth
  authStatus: () => apiRequest<AuthStatusResponse>('/api/auth/status'),
  bootstrapAdmin: (payload: {
    username: string;
    displayName: string;
    password: string;
    adminPasscode?: string;
  }) =>
    apiRequest<{ token: string; user: UserAccount }>('/api/auth/bootstrap-admin', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  login: (username: string, password: string) =>
    apiRequest<{ token: string; user: UserAccount }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => apiRequest<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  workspace: () => apiRequest<WorkspaceSnapshot>('/api/workspace'),

  // M0 Admin
  createUser: (payload: {
    username: string;
    displayName: string;
    email?: string;
    role: UserRole;
    departmentId: string;
    password: string;
  }) =>
    apiRequest<{ user: UserAccount }>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateUser: (
    uid: string,
    payload: Partial<{
      displayName: string;
      email: string;
      role: UserRole;
      departmentId: string;
      status: UserAccount['status'];
      password: string;
    }>
  ) =>
    apiRequest<{ user: UserAccount }>(`/api/admin/users/${uid}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  createDepartment: (name: string, code: string) =>
    apiRequest<{ department: Department }>('/api/admin/departments', {
      method: 'POST',
      body: JSON.stringify({ name, code }),
    }),
  updateDepartment: (id: string, payload: { name?: string; active?: boolean }) =>
    apiRequest<{ department: Department }>(`/api/admin/departments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  createHoliday: (date: string, label: string, status: 'previsionnel' | 'confirme') =>
    apiRequest<{ holiday: HolidayEntry; impactedTasksCount: number }>('/api/admin/holidays', {
      method: 'POST',
      body: JSON.stringify({ date, label, status }),
    }),
  updateHoliday: (id: string, payload: Partial<HolidayEntry>) =>
    apiRequest<{ holiday: HolidayEntry; impactedTasksCount: number }>(`/api/admin/holidays/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteHoliday: (id: string) =>
    apiRequest<{ ok: boolean }>(`/api/admin/holidays/${id}`, { method: 'DELETE' }),
  createSchedule: (payload: Partial<WorkSchedule>) =>
    apiRequest<{ schedule: WorkSchedule }>('/api/admin/schedules', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSchedule: (id: string, payload: Partial<WorkSchedule>) =>
    apiRequest<{ schedule: WorkSchedule; impactedTasksCount: number }>(`/api/admin/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  createDelegation: (payload: {
    delegatorId: string;
    delegateeId: string;
    startDate: string;
    endDate: string;
    isSingleDirectorException: boolean;
    sponsorNote?: string;
  }) =>
    apiRequest<{ delegation: Delegation }>('/api/admin/delegations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  revokeDelegation: (id: string) =>
    apiRequest<{ delegation: Delegation }>(`/api/admin/delegations/${id}/revoke`, {
      method: 'PATCH',
    }),
  updateSettings: (payload: Partial<PlatformSettings>) =>
    apiRequest<{ settings: PlatformSettings; effectiveTodayISO: string }>('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  seedReferenceDataset: (demoPassword?: string) =>
    apiRequest<{
      accounts: { username: string; displayName: string; role: UserRole; temporaryPassword: string }[];
      systemDateOverride: string;
    }>('/api/admin/seed-cdc-reference', {
      method: 'POST',
      body: JSON.stringify({ demoPassword }),
    }),
  downloadAuditCsv: async () => {
    const res = await fetch('/api/admin/audit/csv', {
      headers: { Authorization: `Bearer ${memoryToken}` },
    });
    if (!res.ok) throw new Error('Échec de l’export CSV AD9');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'journal-ad9.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // M1 Projects
  createProject: (payload: {
    code?: string;
    title: string;
    description: string;
    priority: Priority;
    responsable0Id: string;
    workScheduleId: string;
    currency: string;
    showAmountsToResponsable: boolean;
    multiDirectorRule: 'accord_de_tous' | 'un_seul_suffit';
    targetStartDate: string;
    targetEndDate: string;
    isMigration?: boolean;
    migrationBudgetLines?: { category: string; designation: string; plannedAmount: number }[];
    phases: {
      key: PhaseKey;
      transitionFromPrev: TransitionMode;
      stakeholders: { uid: string; isLead: boolean }[];
      closedOutOfTool?: boolean;
    }[];
    initialTasks?: {
      title: string;
      description?: string;
      priority: Priority;
      startDate: string;
      endDate: string;
      assigneeId: string;
      coPilotIds?: string[];
      executionMode?: TaskExecutionMode;
    }[];
  }) =>
    apiRequest<{ project: Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateProject: (
    id: string,
    payload: Partial<{
      title: string;
      description: string;
      priority: Priority;
      responsable0Id: string;
      showAmountsToResponsable: boolean;
      attachedSupplierIds: string[];
    }>
  ) =>
    apiRequest<{ project: Project }>(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  completePhase: (projectId: string, phaseKey: PhaseKey, notes?: string) =>
    apiRequest<{ project: Project }>(`/api/projects/${projectId}/phases/${phaseKey}/complete`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),
  validationDecision: (
    projectId: string,
    payload: { decision: 'valide' | 'a_revoir' | 'rejete'; comment?: string; returnToPhase?: PhaseKey }
  ) =>
    apiRequest<{ project: Project }>(`/api/projects/${projectId}/validation-decision`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  suspendProject: (
    projectId: string,
    payload: { reasonCategory: string; reasonComment: string; plannedResumeDate?: string }
  ) =>
    apiRequest<{ project: Project }>(`/api/projects/${projectId}/suspend`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  resumeProject: (projectId: string, shiftUnstartedTasks: boolean) =>
    apiRequest<{ project: Project; pauseWorkedDays: number; shiftedCount: number }>(
      `/api/projects/${projectId}/resume`,
      {
        method: 'POST',
        body: JSON.stringify({ shiftUnstartedTasks }),
      }
    ),
  cancelProject: (projectId: string, reason: string) =>
    apiRequest<{ project: Project }>(`/api/projects/${projectId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  launchPlanning: (projectId: string) =>
    apiRequest<{ project: Project }>(`/api/projects/${projectId}/launch-planning`, { method: 'POST' }),
  requestBaseline: (projectId: string, reason: string) =>
    apiRequest<{ project: Project }>(`/api/projects/${projectId}/baseline-request`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  decideBaselineRequest: (
    projectId: string,
    reqId: string,
    decision: 'validee' | 'refusee',
    note?: string
  ) =>
    apiRequest<{ project: Project }>(`/api/projects/${projectId}/baseline-request/${reqId}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision, note }),
    }),
  decideControlTask: (
    projectId: string,
    taskId: string,
    decision: 'validee' | 'refusee',
    note?: string
  ) =>
    apiRequest<{ project: Project }>(`/api/projects/${projectId}/control/${taskId}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision, note }),
    }),
  validateAllControl: (projectId: string) =>
    apiRequest<{ project: Project }>(`/api/projects/${projectId}/control/validate-all`, {
      method: 'POST',
    }),
  closingSignOff: (projectId: string, action: 'sign' | 'cancel', comment?: string) =>
    apiRequest<{ project: Project }>(`/api/projects/${projectId}/closing/signoff`, {
      method: 'POST',
      body: JSON.stringify({ action, comment }),
    }),
  finalizeClosing: (projectId: string) =>
    apiRequest<{ project: Project }>(`/api/projects/${projectId}/closing/finalize`, {
      method: 'POST',
    }),

  // M2 Tasks
  createTask: (
    projectId: string,
    payload: {
      parentId?: string | null;
      title: string;
      description?: string;
      priority: Priority;
      startDate: string;
      endDate: string;
      assigneeId: string;
      coPilotIds?: string[];
      executionMode: TaskExecutionMode;
      supplierId?: string;
      proposeSupplier?: { name: string; ice: string; domain?: string; contactName?: string; contactPhone?: string; contactEmail?: string };
      workScheduleId?: string;
      dependencies?: TaskDependency[];
      isMigrationCompleted?: boolean;
      expectedPlanningRevision: number;
    }
  ) =>
    apiRequest<{ task: ProjectTask; project: Project }>(`/api/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTask: (
    projectId: string,
    taskId: string,
    payload: Partial<ProjectTask> & { expectedPlanningRevision: number }
  ) =>
    apiRequest<{ task: ProjectTask; project: Project }>(`/api/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  applyCascade: (
    projectId: string,
    taskId: string,
    newEndDate: string,
    overrideReactions: Record<string, 'sans_impact' | 'decaler'>
  ) =>
    apiRequest<{ project: Project }>(`/api/projects/${projectId}/tasks/${taskId}/apply-cascade`, {
      method: 'POST',
      body: JSON.stringify({ newEndDate, overrideReactions }),
    }),
  resolveCalendarConflict: (projectId: string, taskId: string, mode: 'keep' | 'shift') =>
    apiRequest<{ task: ProjectTask; project: Project }>(
      `/api/projects/${projectId}/tasks/${taskId}/resolve-calendar-conflict`,
      {
        method: 'POST',
        body: JSON.stringify({ mode }),
      }
    ),
  taskAction: (
    projectId: string,
    taskId: string,
    payload: {
      action: 'start' | 'progress' | 'wait' | 'complete' | 'reopen' | 'cancel';
      progress?: number;
      reason?: string;
      delayJustification?: string;
    }
  ) =>
    apiRequest<{ task: ProjectTask; project: Project }>(
      `/api/projects/${projectId}/tasks/${taskId}/action`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  // M3 Interventions
  createIntervention: (payload: {
    parentId?: string | null;
    title: string;
    description?: string;
    priority: Priority;
    location?: string;
    requesterName?: string;
    startDate: string;
    endDate: string;
    assigneeId: string;
    executionMode: TaskExecutionMode;
    supplierId?: string;
    workScheduleId?: string;
  }) =>
    apiRequest<{ intervention: Intervention }>('/api/interventions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  interventionAction: (
    id: string,
    payload: {
      action: 'start' | 'progress' | 'wait' | 'complete' | 'cancel';
      progress?: number;
      reason?: string;
      delayJustification?: string;
    }
  ) =>
    apiRequest<{ intervention: Intervention }>(`/api/interventions/${id}/action`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // M5 Suppliers, Budget, PO, Invoices
  createSupplier: (payload: {
    name: string;
    ice: string;
    domain?: string;
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
  }) =>
    apiRequest<{ supplier: Supplier }>('/api/suppliers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSupplier: (id: string, payload: Partial<Supplier>) =>
    apiRequest<{ supplier: Supplier }>(`/api/suppliers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  createBudgetRevision: (
    projectId: string,
    payload: {
      reason: string;
      submit: boolean;
      lines: { id?: string; category: string; designation: string; plannedAmount: number }[];
    }
  ) =>
    apiRequest<{ budgetRevision: BudgetRevision }>(`/api/projects/${projectId}/budget-revisions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  decideBudgetRevision: (
    projectId: string,
    revId: string,
    decision: 'validee' | 'a_revoir' | 'rejetee',
    comment?: string
  ) =>
    apiRequest<{ budgetRevision: BudgetRevision; project: Project }>(
      `/api/projects/${projectId}/budget-revisions/${revId}/decide`,
      {
        method: 'POST',
        body: JSON.stringify({ decision, comment }),
      }
    ),
  createPurchaseOrder: (
    projectId: string,
    payload: {
      budgetLineId: string;
      number: string;
      issueDate: string;
      supplierId: string;
      amountHT: number;
      vatRate: 0 | 7 | 10 | 14 | 20;
      attachmentId: string;
      exceedReason?: string;
    }
  ) =>
    apiRequest<{ purchaseOrder: PurchaseOrder }>(`/api/projects/${projectId}/purchase-orders`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  cancelPurchaseOrder: (projectId: string, poId: string, reason: string) =>
    apiRequest<{ purchaseOrder: PurchaseOrder }>(
      `/api/projects/${projectId}/purchase-orders/${poId}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    ),
  createInvoice: (
    projectId: string,
    payload: {
      orderId: string;
      type: 'facture' | 'avoir';
      number: string;
      issueDate: string;
      originalCurrency: string;
      originalAmountHT: number;
      exchangeRate: number;
      attachmentId: string;
      exceedReason?: string;
    }
  ) =>
    apiRequest<{ invoice: InvoiceRecord }>(`/api/projects/${projectId}/invoices`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // M8 Notifications & Attachments
  markNotificationRead: (id: string) =>
    apiRequest<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () =>
    apiRequest<{ ok: boolean }>('/api/notifications/read-all', { method: 'POST' }),
  uploadAttachment: async (params: {
    file: File;
    entityType: Attachment['entityType'];
    entityId: string;
    projectId: string;
    previousVersionId?: string;
  }): Promise<Attachment> => {
    const contentBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
      reader.readAsDataURL(params.file);
    });
    const res = await apiRequest<{ attachment: Attachment }>('/api/attachments', {
      method: 'POST',
      body: JSON.stringify({
        fileName: params.file.name,
        contentBase64,
        entityType: params.entityType,
        entityId: params.entityId,
        projectId: params.projectId,
        previousVersionId: params.previousVersionId,
      }),
    });
    return res.attachment;
  },
  downloadAttachment: async (att: Attachment) => {
    const res = await fetch(`/api/attachments/${att.id}/download`, {
      headers: { Authorization: `Bearer ${memoryToken}` },
    });
    if (!res.ok) throw new Error('Téléchargement impossible');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  removeAttachment: (id: string) =>
    apiRequest<{ ok: boolean }>(`/api/attachments/${id}`, { method: 'DELETE' }),
};

export function connectWorkspaceWebSocket(
  token: string,
  onSync: (snapshot: WorkspaceSnapshot) => void
): () => void {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
  let closed = false;
  let ws: WebSocket | null = null;
  let retryTimer: number | null = null;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(wsUrl);
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg?.type === 'workspace:sync' && msg.payload) {
          onSync(msg.payload);
        }
      } catch {
        // ignore parse errors
      }
    };
    ws.onclose = () => {
      if (!closed) {
        retryTimer = window.setTimeout(connect, 2500);
      }
    };
  };

  connect();

  return () => {
    closed = true;
    if (retryTimer) window.clearTimeout(retryTimer);
    ws?.close();
  };
}
