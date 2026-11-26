import React from 'react';
import type {
  ComputedTaskMetrics,
  PhaseStatus,
  Priority,
  ProjectStatus,
  SupplierStatus,
  TaskStatus,
} from '../shared/types';
import {
  PHASE_STATUS_LABELS,
  PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  TASK_STATUS_LABELS,
} from '../shared/types';

export function PriorityBadge({ priority }: { priority: Priority }) {
  const styles: Record<Priority, string> = {
    critique: 'bg-red-50 text-red-800 border-red-200',
    haute: 'bg-amber-50 text-amber-800 border-amber-200',
    moyenne: 'bg-blue-50 text-[#2448C9] border-blue-200',
    basse: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold border rounded ${styles[priority]}`}>
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const styles: Record<TaskStatus, string> = {
    a_faire: 'bg-slate-100 text-slate-700 border-slate-200',
    en_cours: 'bg-blue-50 text-[#2448C9] border-blue-200',
    en_attente: 'bg-amber-50 text-amber-800 border-amber-200',
    terminee: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    annulee: 'bg-slate-100 text-slate-500 border-slate-200 line-through',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium border rounded ${styles[status]}`}>
      {TASK_STATUS_LABELS[status]}
    </span>
  );
}

export function ProjectStatusBadge({
  status,
  inPreparation,
}: {
  status: ProjectStatus;
  inPreparation?: boolean;
}) {
  if (status === 'actif' && inPreparation) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold border rounded bg-indigo-50 text-indigo-800 border-indigo-200">
        En préparation
      </span>
    );
  }
  const styles: Record<ProjectStatus, string> = {
    actif: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    suspendu: 'bg-amber-50 text-amber-800 border-amber-200',
    annule: 'bg-red-50 text-red-800 border-red-200',
    clos: 'bg-slate-200 text-slate-800 border-slate-300',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold border rounded ${styles[status]}`}>
      {PROJECT_STATUS_LABELS[status]}
    </span>
  );
}

export function PhaseStatusBadge({ status }: { status: PhaseStatus }) {
  const styles: Record<PhaseStatus, string> = {
    non_demarree: 'bg-slate-100 text-slate-600 border-slate-200',
    en_cours: 'bg-blue-50 text-[#2448C9] border-blue-200',
    terminee: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    a_revoir: 'bg-amber-50 text-amber-800 border-amber-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium border rounded ${styles[status]}`}>
      {PHASE_STATUS_LABELS[status]}
    </span>
  );
}

export function VarianceBadge({ metrics }: { metrics: ComputedTaskMetrics }) {
  const styles: Record<ComputedTaskMetrics['varianceStatus'], string> = {
    avance: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    a_lheure: 'bg-blue-50 text-[#2448C9] border-blue-200',
    retard_projete: 'bg-amber-50 text-amber-800 border-amber-200',
    depasse: 'bg-red-50 text-red-800 border-red-200',
    non_demarree: 'bg-amber-50 text-amber-800 border-amber-200',
    neutre: 'bg-slate-50 text-slate-500 border-slate-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium border rounded tabular-nums ${styles[metrics.varianceStatus]}`}>
      {metrics.varianceLabel}
    </span>
  );
}

export function SupplierStatusBadge({ status }: { status: SupplierStatus }) {
  const map: Record<SupplierStatus, { label: string; cls: string }> = {
    qualifie: { label: 'Qualifié', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    a_verifier: { label: 'À vérifier', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
    inactif: { label: 'Inactif', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  };
  const cfg = map[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium border rounded ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}
