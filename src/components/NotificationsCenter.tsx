import React, { useState } from 'react';
import { Bell, CheckCheck, ExternalLink } from 'lucide-react';
import { api } from '../services/api';
import type { AlertFamily, NotificationItem } from '../shared/types';

interface NotificationsCenterProps {
  notifications: NotificationItem[];
  onOpenProject: (projectId: string) => void;
  onRefresh: () => void;
}

const FAMILY_LABELS: Record<'all' | AlertFamily, string> = {
  all: 'Toutes',
  retards: 'Retards & conflits',
  phases: 'Phases & décisions',
  controle_cloture: 'Contrôle & clôture',
  achats: 'Achats & prestataires',
};

export const NotificationsCenter: React.FC<NotificationsCenterProps> = ({
  notifications,
  onOpenProject,
  onRefresh,
}) => {
  const [family, setFamily] = useState<'all' | AlertFamily>('all');
  const [onlyUnread, setOnlyUnread] = useState(false);

  const filtered = notifications.filter((n) => {
    if (family !== 'all' && n.family !== family) return false;
    if (onlyUnread && n.read) return false;
    return true;
  });

  const handleMarkAllRead = async () => {
    await api.markAllNotificationsRead();
    onRefresh();
  };

  const handleOpen = async (n: NotificationItem) => {
    if (!n.read) {
      await api.markNotificationRead(n.id);
      onRefresh();
    }
    if (n.projectId) {
      onOpenProject(n.projectId);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 font-display flex items-center gap-2">
            <Bell className="w-5 h-5 text-[#2448C9]" />
            Centre de notifications (AL1–AL14)
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Alertes actives regroupées par famille, avec routage automatique en cas de délégation.
          </p>
        </div>

        <button
          type="button"
          onClick={handleMarkAllRead}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer"
        >
          <CheckCheck className="w-4 h-4 text-[#2448C9]" />
          Tout marquer comme lu
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(FAMILY_LABELS) as ('all' | AlertFamily)[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFamily(key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                family === key
                  ? 'bg-[#2448C9] text-white border-[#2448C9]'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {FAMILY_LABELS[key]}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyUnread}
            onChange={(e) => setOnlyUnread(e.target.checked)}
            className="rounded border-slate-300 text-[#2448C9]"
          />
          Non lues uniquement
        </label>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Aucune notification dans cette catégorie.
          </div>
        ) : (
          filtered.map((n) => (
            <div
              key={n.id}
              className={`p-4 flex items-start justify-between gap-4 ${
                n.read ? 'bg-white' : 'bg-blue-50/40'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[11px] font-semibold px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded border border-slate-200">
                    {n.code}
                  </span>
                  <span className="text-xs font-medium text-slate-500">
                    {FAMILY_LABELS[n.family]}
                  </span>
                  {!n.read && (
                    <span className="text-[11px] font-semibold text-[#2448C9]">Non lue</span>
                  )}
                </div>
                <p className="text-sm font-semibold text-slate-900 mt-1">{n.title}</p>
                <p className="text-sm text-slate-600 mt-0.5">{n.message}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {n.projectId && (
                  <button
                    type="button"
                    onClick={() => handleOpen(n)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#2448C9] bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer"
                  >
                    Ouvrir
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
                {!n.read && !n.projectId && (
                  <button
                    type="button"
                    onClick={() => handleOpen(n)}
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Marquer lue
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
