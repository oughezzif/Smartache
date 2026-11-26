import React, { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  Building,
  CheckSquare,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Shield,
  X,
} from 'lucide-react';
import { AdminWorkspaceView } from './components/AdminWorkspaceView';
import { AuthScreen } from './components/AuthScreen';
import { DashboardView } from './components/DashboardView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MyTasksView } from './components/MyTasksView';
import { NotificationsCenter } from './components/NotificationsCenter';
import { ProjectDetailView } from './components/ProjectDetailView';
import { ProjectsAndInterventionsView } from './components/ProjectsAndInterventionsView';
import { SuppliersDirectoryView } from './components/SuppliersDirectoryView';
import {
  api,
  clearAuthToken,
  connectWorkspaceWebSocket,
  getAuthToken,
  setOnUnauthorized,
  type AuthStatusResponse,
  type WorkspaceSnapshot,
} from './services/api';
import { formatDateFR } from './shared/calculationEngine';
import { ROLE_LABELS, type AppSection, type UserAccount } from './shared/types';

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [section, setSection] = useState<AppSection>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = useCallback(async () => {
    try {
      if (getAuthToken()) await api.logout();
    } catch {
      // ignore
    }
    clearAuthToken();
    setCurrentUser(null);
    setSnapshot(null);
    setSelectedProjectId(null);
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => {
      setCurrentUser(null);
      setSnapshot(null);
    });
    api.authStatus().then(setAuthStatus).catch(() => {});
  }, []);

  const refreshWorkspace = useCallback(async () => {
    if (!getAuthToken()) return;
    try {
      const snap = await api.workspace();
      setSnapshot(snap);
      setCurrentUser(snap.currentUser);
    } catch {
      // handled by onUnauthorized
    }
  }, []);

  // WebSocket real-time sync + 30-min inactivity logout
  useEffect(() => {
    const token = getAuthToken();
    if (!currentUser || !token) return;

    refreshWorkspace();
    const disconnectWs = connectWorkspaceWebSocket(token, (nextSnap) => {
      setSnapshot(nextSnap);
    });

    let lastActivity = Date.now();
    const bump = () => {
      lastActivity = Date.now();
    };
    window.addEventListener('mousemove', bump);
    window.addEventListener('keydown', bump);
    window.addEventListener('click', bump);

    const interval = window.setInterval(() => {
      if (Date.now() - lastActivity >= INACTIVITY_LIMIT_MS) {
        handleLogout();
      }
    }, 30000);

    return () => {
      disconnectWs();
      window.removeEventListener('mousemove', bump);
      window.removeEventListener('keydown', bump);
      window.removeEventListener('click', bump);
      window.clearInterval(interval);
    };
  }, [currentUser?.uid, handleLogout, refreshWorkspace]);

  const handleAuthenticated = (user: UserAccount) => {
    setCurrentUser(user);
    setSection(user.role === 'administrateur' ? 'admin' : 'dashboard');
    setSelectedProjectId(null);
  };

  if (!authStatus) {
    return (
      <div className="min-h-screen bg-[#F4F5F7] flex items-center justify-center text-sm text-slate-600">
        Chargement de Cadence...
      </div>
    );
  }

  if (!currentUser || !snapshot) {
    return (
      <ErrorBoundary>
        <AuthScreen authStatus={authStatus} onAuthenticated={handleAuthenticated} />
      </ErrorBoundary>
    );
  }

  const unreadNotifs = snapshot.notifications.filter((n) => !n.read).length;

  const navItems: { id: AppSection; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }[] =
    currentUser.role === 'administrateur'
      ? [{ id: 'admin', label: 'Administration M0', icon: Shield }]
      : currentUser.role === 'directeur'
      ? [
          { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
          { id: 'projects', label: 'Projets & Interventions', icon: FolderKanban },
          { id: 'suppliers', label: 'Prestataires', icon: Building },
          { id: 'notifications', label: 'Notifications', icon: Bell, badge: unreadNotifs },
        ]
      : [
          { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
          { id: 'my_tasks', label: 'Mes tâches', icon: CheckSquare },
          { id: 'projects', label: 'Projets & Interventions', icon: FolderKanban },
          { id: 'suppliers', label: 'Prestataires', icon: Building },
          { id: 'notifications', label: 'Notifications', icon: Bell, badge: unreadNotifs },
        ];

  const openProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setSection('project_detail');
    setMobileMenuOpen(false);
  };

  const selectedProject = selectedProjectId
    ? snapshot.projects.find((p) => p.id === selectedProjectId) || null
    : null;

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#F4F5F7] flex flex-col">
        {/* Top Bar */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-30 no-print">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden p-1.5 text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#2448C9] text-white flex items-center justify-center font-display font-bold text-sm">
                  C
                </div>
                <span className="font-display font-bold text-slate-900 tracking-tight">Cadence</span>
              </div>

              <nav className="hidden lg:flex items-center gap-1 ml-6">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active =
                    section === item.id ||
                    (section === 'project_detail' && item.id === 'projects');
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSection(item.id);
                        if (item.id !== 'project_detail') setSelectedProjectId(null);
                      }}
                      className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#2448C9]/10 text-[#2448C9]'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                      {typeof item.badge === 'number' && item.badge > 0 && (
                        <span className="px-1.5 py-0.2 rounded bg-[#2448C9] text-white text-[10px] font-bold tabular-nums">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden sm:block text-right text-xs">
                <div className="font-semibold text-slate-900">{currentUser.displayName}</div>
                <div className="text-slate-500">
                  {ROLE_LABELS[currentUser.role]} · {formatDateFR(snapshot.effectiveTodayISO)}
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer"
                title="Déconnexion"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Déconnexion</span>
              </button>
            </div>
          </div>

          {mobileMenuOpen && (
            <div className="lg:hidden border-t border-slate-200 bg-white px-4 py-2 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSection(item.id);
                      setSelectedProjectId(null);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm font-semibold rounded-lg ${
                      active ? 'bg-[#2448C9]/10 text-[#2448C9]' : 'text-slate-700'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </span>
                    {typeof item.badge === 'number' && item.badge > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-[#2448C9] text-white text-xs">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </header>

        {/* Workspace Canvas */}
        <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6">
          {currentUser.role === 'administrateur' ? (
            <AdminWorkspaceView snapshot={snapshot} onRefresh={refreshWorkspace} />
          ) : section === 'project_detail' && selectedProject ? (
            <ProjectDetailView
              project={selectedProject}
              snapshot={snapshot}
              onBack={() => {
                setSection('projects');
                setSelectedProjectId(null);
              }}
              onRefresh={refreshWorkspace}
            />
          ) : section === 'projects' ? (
            <ProjectsAndInterventionsView
              snapshot={snapshot}
              onOpenProject={openProject}
              onRefresh={refreshWorkspace}
            />
          ) : section === 'my_tasks' ? (
            <MyTasksView
              snapshot={snapshot}
              onOpenProject={openProject}
              onRefresh={refreshWorkspace}
            />
          ) : section === 'suppliers' ? (
            <SuppliersDirectoryView snapshot={snapshot} onRefresh={refreshWorkspace} />
          ) : section === 'notifications' ? (
            <NotificationsCenter
              notifications={snapshot.notifications}
              onOpenProject={openProject}
              onRefresh={refreshWorkspace}
            />
          ) : (
            <DashboardView
              snapshot={snapshot}
              onOpenProject={openProject}
              onNavigate={(s) => setSection(s)}
            />
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}
