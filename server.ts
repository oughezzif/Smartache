import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { evaluateAllAlerts } from './server/alertsEngine.ts';
import { createAdminRouter } from './server/routesAdmin.ts';
import {
  buildWorkspaceSnapshot,
  createInterventionsAndFilesRouter,
} from './server/routesInterventionsAndFiles.ts';
import { createProjectsRouter } from './server/routesProjects.ts';
import { createTasksAndBudgetRouter } from './server/routesTasksAndBudget.ts';
import {
  LOCKOUT_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
  cleanString,
  createSessionToken,
  hashPassword,
  makeId,
  recordAdminAudit,
  revokeSessionToken,
  saveStore,
  store,
  stripUserSecrets,
  validateSessionToken,
  verifyPassword,
  type StoredUser,
} from './server/store.ts';

interface AuthedRequest extends Request {
  currentUser?: StoredUser;
  authToken?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;

const app = express();
app.use(express.json({ limit: '30mb' }));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const wsClients = new Map<WebSocket, { uid: string }>();

function broadcastWorkspaceSync(): void {
  evaluateAllAlerts();
  for (const [client, meta] of wsClients.entries()) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const user = store.users.find((u) => u.uid === meta.uid && u.status === 'actif');
    if (!user) continue;
    client.send(
      JSON.stringify({
        type: 'workspace:sync',
        payload: buildWorkspaceSnapshot(user),
      })
    );
  }
}

server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const token = url.searchParams.get('token') || '';
    const session = validateSessionToken(token);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const user = store.users.find((u) => u.uid === session.uid && u.status === 'actif');
    if (!user) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, user);
    });
  } catch {
    socket.destroy();
  }
});

wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, user: StoredUser) => {
  wsClients.set(ws, { uid: user.uid });
  ws.send(
    JSON.stringify({
      type: 'workspace:sync',
      payload: buildWorkspaceSnapshot(user),
    })
  );
  ws.on('close', () => {
    wsClients.delete(ws);
  });
});

// ---------------------------------------------------------------------------
// Auth Middleware
// ---------------------------------------------------------------------------
function extractBearer(req: Request): string {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  const session = validateSessionToken(token);
  if (!session) {
    res.status(401).json({ error: 'Session expirée ou non authentifiée. Veuillez vous reconnecter.' });
    return;
  }
  const user = store.users.find((u) => u.uid === session.uid);
  if (!user || user.status !== 'actif') {
    res.status(403).json({ error: 'Compte inactif ou suspendu.' });
    return;
  }
  req.currentUser = user;
  req.authToken = token;
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.currentUser?.role !== 'administrateur') {
    res.status(403).json({ error: 'Accès réservé au rôle Administrateur.' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Auth Endpoints (Local Login + Password, 5-attempt Lockout, First-run Admin)
// ---------------------------------------------------------------------------
app.get('/api/auth/status', (_req, res) => {
  const hasAdmin = store.users.some((u) => u.role === 'administrateur');
  res.json({
    hasAdmin,
    totalUsers: store.users.length,
    envPasscodeConfigured: Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length >= 8),
  });
});

app.post('/api/auth/bootstrap-admin', (req, res) => {
  const hasAdmin = store.users.some((u) => u.role === 'administrateur');
  if (hasAdmin) {
    res.status(409).json({ error: 'Un compte Administrateur est déjà configuré.' });
    return;
  }
  const username = cleanString(req.body?.username, 60).toLowerCase();
  const displayName = cleanString(req.body?.displayName, 100);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const envPasscode = process.env.ADMIN_PASSCODE?.trim();

  if (envPasscode && req.body?.adminPasscode !== envPasscode) {
    res.status(403).json({ error: 'Code ADMIN_PASSCODE invalide.' });
    return;
  }
  if (!username || !displayName) {
    res.status(400).json({ error: 'Identifiant et nom complet requis.' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
    return;
  }

  const { salt, hash } = hashPassword(password);
  const now = new Date().toISOString();
  const admin: StoredUser = {
    uid: makeId('usr_adm'),
    username,
    displayName,
    email: `${username}@entreprise.ma`,
    role: 'administrateur',
    departmentId: 'dept_admin',
    departmentName: 'Administration Générale',
    status: 'actif',
    failedAttempts: 0,
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: now,
    updatedAt: now,
  };

  store.users.push(admin);
  recordAdminAudit('ADMIN_BOOTSTRAP', 'identite', admin, admin.displayName, 'Initialisation du premier compte Administrateur');
  saveStore();

  const token = createSessionToken(admin.uid);
  res.status(201).json({ token, user: stripUserSecrets(admin) });
});

app.post('/api/auth/login', (req, res) => {
  const username = cleanString(req.body?.username, 60).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
    return;
  }

  const user = store.users.find((u) => u.username.toLowerCase() === username);
  if (!user) {
    res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    return;
  }

  if (user.status === 'en_attente') {
    res.status(403).json({ error: 'Compte en attente de validation par un Administrateur.' });
    return;
  }
  if (user.status === 'desactive') {
    res.status(403).json({ error: 'Ce compte est désactivé.' });
    return;
  }

  const nowMs = Date.now();
  if (user.lockedUntil) {
    const lockMs = new Date(user.lockedUntil).getTime();
    if (lockMs > nowMs) {
      const minsLeft = Math.ceil((lockMs - nowMs) / 60000);
      res.status(423).json({
        error: `Compte verrouillé après ${MAX_FAILED_ATTEMPTS} tentatives échouées. Réessayez dans ${minsLeft} min.`,
      });
      return;
    }
    user.lockedUntil = undefined;
    user.failedAttempts = 0;
  }

  const ok = verifyPassword(password, user.passwordSalt, user.passwordHash);
  if (!ok) {
    user.failedAttempts += 1;
    if (user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = new Date(nowMs + LOCKOUT_DURATION_MS).toISOString();
      recordAdminAudit(
        'AUTH_LOCKOUT',
        'identite',
        user,
        user.username,
        `Verrouillage 15 min après ${MAX_FAILED_ATTEMPTS} échecs consécutifs`
      );
    } else {
      recordAdminAudit(
        'AUTH_FAILED',
        'identite',
        user,
        user.username,
        `Échec connexion (${user.failedAttempts}/${MAX_FAILED_ATTEMPTS})`
      );
    }
    saveStore();
    res.status(401).json({
      error:
        user.failedAttempts >= MAX_FAILED_ATTEMPTS
          ? `Compte verrouillé 15 minutes suite à ${MAX_FAILED_ATTEMPTS} échecs.`
          : 'Identifiant ou mot de passe incorrect.',
    });
    return;
  }

  user.failedAttempts = 0;
  user.lockedUntil = undefined;
  recordAdminAudit('AUTH_LOGIN', 'identite', user, user.username, `Connexion réussie (${user.role})`);
  saveStore();

  const token = createSessionToken(user.uid);
  res.json({ token, user: stripUserSecrets(user) });
});

app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res) => {
  if (req.authToken) revokeSessionToken(req.authToken);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: stripUserSecrets(req.currentUser!) });
});

// ---------------------------------------------------------------------------
// Mount Domain Routers
// ---------------------------------------------------------------------------
app.use('/api/admin', createAdminRouter(requireAuth, requireAdmin, broadcastWorkspaceSync));
app.use('/api/projects', createProjectsRouter(requireAuth, broadcastWorkspaceSync));
app.use('/api', createTasksAndBudgetRouter(requireAuth, broadcastWorkspaceSync));
app.use('/api', createInterventionsAndFilesRouter(requireAuth, broadcastWorkspaceSync));

// ---------------------------------------------------------------------------
// Vite Dev Middleware / Production Static Serving
// ---------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Cadence CDC v6 server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
