import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  PlatformSettings,
  Project,
  ProjectTask,
  PurchaseOrder,
  InvoiceRecord,
  Supplier,
  UserAccount,
  UserRole,
  WorkSchedule,
} from '../src/shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.resolve(ROOT_DIR, 'data');
export const UPLOADS_DIR = path.resolve(DATA_DIR, 'uploads');
export const STORE_PATH = path.resolve(DATA_DIR, 'cdc-store.json');

export interface StoredUser extends UserAccount {
  passwordSalt: string;
  passwordHash: string;
}

export interface CdcStore {
  users: StoredUser[];
  departments: Department[];
  holidays: HolidayEntry[];
  workSchedules: WorkSchedule[];
  delegations: Delegation[];
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
  adminAudit: AdminAuditEntry[];
  settings: PlatformSettings;
}

export interface SessionRecord {
  tokenId: string;
  uid: string;
  lastActiveMs: number;
  createdAtMs: number;
}

const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16
    ? process.env.SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;

const activeSessions = new Map<string, SessionRecord>();

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function cleanString(val: unknown, maxLen = 500): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

export function hashPassword(password: string, existingSalt?: string): { salt: string; hash: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash: derived };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function createSessionToken(uid: string): string {
  const tokenId = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  activeSessions.set(tokenId, {
    tokenId,
    uid,
    lastActiveMs: now,
    createdAtMs: now,
  });
  const payload = `${tokenId}.${uid}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function validateSessionToken(token: string): { uid: string; tokenId: string } | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [tokenId, uid, sig] = parts;
  const payload = `${tokenId}.${uid}`;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  const sess = activeSessions.get(tokenId);
  if (!sess || sess.uid !== uid) return null;
  const now = Date.now();
  if (now - sess.lastActiveMs > INACTIVITY_TIMEOUT_MS) {
    activeSessions.delete(tokenId);
    return null;
  }
  sess.lastActiveMs = now;
  return { uid, tokenId };
}

export function revokeSessionToken(token: string): void {
  const parts = token.split('.');
  if (parts.length === 3) {
    activeSessions.delete(parts[0]);
  }
}

export function revokeUserSessions(uid: string): void {
  for (const [key, sess] of activeSessions.entries()) {
    if (sess.uid === uid) {
      activeSessions.delete(key);
    }
  }
}

export function defaultSettings(): PlatformSettings {
  return {
    defaultCurrency: 'MAD',
    availableCurrencies: ['MAD', 'EUR', 'USD'],
    al1ThresholdPoints: 10,
    al9ReminderDays: 2,
    alertReminderDays: 7,
    maxFileSizeMb: 20,
    allowedExtensions: ['pdf', 'docx', 'xlsx', 'jpg', 'jpeg', 'png', 'heic'],
    migrationModeEnabled: true,
    migrationEndsAt: '2027-06-30',
  };
}

export function defaultDepartments(): Department[] {
  const now = new Date().toISOString();
  return [
    { id: 'dept_admin', name: 'Administration Générale', code: 'ADM', active: true, createdAt: now },
    { id: 'dept_dir', name: 'Direction Générale', code: 'DIR', active: true, createdAt: now },
    { id: 'dept_it', name: 'IT & Réseaux', code: 'IT', active: true, createdAt: now },
    { id: 'dept_achats', name: 'Achats & Finances', code: 'ACH', active: true, createdAt: now },
    { id: 'dept_infra', name: 'Infrastructure & Maintenance', code: 'INF', active: true, createdAt: now },
  ];
}

export function defaultSchedules(): WorkSchedule[] {
  return [
    {
      id: 'sched_ouvres',
      name: 'Jours ouvrés',
      workingDays: [1, 2, 3, 4, 5],
      applyHolidays: true,
      hoursInfo: '08:30–17:30',
      periods: [],
      active: true,
      isDefault: true,
    },
    {
      id: 'sched_calendaires',
      name: 'Jours calendaires',
      workingDays: [0, 1, 2, 3, 4, 5, 6],
      applyHolidays: false,
      hoursInfo: '7j/7 continu',
      periods: [],
      active: true,
      isDefault: false,
    },
  ];
}

export function createEmptyStore(): CdcStore {
  return {
    users: [],
    departments: defaultDepartments(),
    holidays: [],
    workSchedules: defaultSchedules(),
    delegations: [],
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
    adminAudit: [],
    settings: defaultSettings(),
  };
}

function ensureDirs(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export function loadStore(): CdcStore {
  ensureDirs();
  if (!fs.existsSync(STORE_PATH)) {
    const empty = createEmptyStore();
    fs.writeFileSync(STORE_PATH, JSON.stringify(empty, null, 2), 'utf8');
    return empty;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CdcStore>;
    const base = createEmptyStore();
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings || {}) },
      departments: parsed.departments?.length ? parsed.departments : base.departments,
      workSchedules: parsed.workSchedules?.length ? parsed.workSchedules : base.workSchedules,
    };
  } catch {
    return createEmptyStore();
  }
}

export const store: CdcStore = loadStore();

export function saveStore(): void {
  ensureDirs();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

export function stripUserSecrets(u: StoredUser): UserAccount {
  const { passwordHash: _ph, passwordSalt: _ps, ...safe } = u;
  return safe;
}

export function recordAdminAudit(
  eventType: string,
  source: 'identite' | 'application',
  actor: { uid: string; displayName: string },
  targetSummary: string,
  details: string
): void {
  store.adminAudit.unshift({
    id: makeId('ad9'),
    eventType,
    source,
    actorId: actor.uid,
    actorName: actor.displayName,
    targetSummary,
    details,
    timestamp: new Date().toISOString(),
  });
  if (store.adminAudit.length > 2000) {
    store.adminAudit.length = 2000;
  }
}

export function recordBusinessHistory(params: {
  projectId?: string;
  entityType: string;
  entityId: string;
  actor: { uid: string; displayName: string };
  onBehalfOf?: string;
  action: string;
  beforeValue?: string;
  afterValue?: string;
  reason?: string;
}): void {
  store.businessHistory.unshift({
    id: makeId('hist'),
    projectId: params.projectId,
    entityType: params.entityType,
    entityId: params.entityId,
    actorId: params.actor.uid,
    actorName: params.actor.displayName,
    onBehalfOf: params.onBehalfOf,
    action: params.action,
    beforeValue: params.beforeValue,
    afterValue: params.afterValue,
    reason: params.reason,
    timestamp: new Date().toISOString(),
  });
  if (store.businessHistory.length > 5000) {
    store.businessHistory.length = 5000;
  }
}

export function hasActiveDelegation(
  actorId: string,
  targetRole: UserRole | undefined,
  action: string,
  todayISO: string
): Delegation | undefined {
  return store.delegations.find((d) => {
    if (!d.active) return false;
    if (d.delegateeId !== actorId) return false;
    if (todayISO < d.startDate || todayISO > d.endDate) return false;
    if (targetRole && d.role !== targetRole) return false;
    if (d.allowedActions.length > 0 && !d.allowedActions.includes('*') && !d.allowedActions.includes(action)) {
      return false;
    }
    return true;
  });
}

export function canActAsRole(
  user: StoredUser,
  requiredRole: UserRole,
  action: string,
  todayISO: string
): { allowed: boolean; delegation?: Delegation } {
  if (user.role === requiredRole) {
    return { allowed: true };
  }
  const del = hasActiveDelegation(user.uid, requiredRole, action, todayISO);
  if (del) {
    return { allowed: true, delegation: del };
  }
  return { allowed: false };
}
