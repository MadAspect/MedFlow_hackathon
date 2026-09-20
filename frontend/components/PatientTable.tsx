"use client";

import { Search, Trash2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, inputClass, type Tone } from "./ui";
import type { PatientRow, PatientStatus } from "@/lib/database";
import { useStore } from "@/lib/store";
import { RESOURCE_KEYS, RESOURCE_LABELS } from "@/lib/simulation";

const STATUS: Record<PatientStatus, { label: string; tone: Tone }> = {
  waiting: { label: "Waiting", tone: "blue" },
  in_treatment: { label: "In treatment", tone: "yellow" },
  treated: { label: "Treated", tone: "green" },
  critical_waiting: { label: "Critical waiting", tone: "red" },
  cancelled: { label: "Cancelled", tone: "grey" },
};

export const statusBadge = (status: PatientStatus) => (
  <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>
);

function resourceSummary(p: PatientRow): string {
  return RESOURCE_KEYS.filter((k) => p.required_resources[k])
    .map((k) => `${RESOURCE_LABELS[k]} ×${p.required_resources[k]}`)
    .join(", ");
}

export function PatientTable() {
  const { patients, deletePatient, cancelPatient } = useStore();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return patients
      .filter(
        (p) =>
          !q ||
          p.patient_id.toLowerCase().includes(q) ||
          p.condition.toLowerCase().includes(q) ||
          STATUS[p.status].label.toLowerCase().includes(q),
      )
      .sort((a, b) => a.arrival_time - b.arrival_time || a.patient_id.localeCompare(b.patient_id));
  }, [patients, query]);

  return (
    <Card
      title={`Patient queue (${patients.length})`}
      description="Sorted by arrival. After a run, Priority is the score when treatment started."
      actions={
        <div className="relative w-full sm:w-64">
          <Search size={16} aria-hidden className="absolute top-2.5 left-2.5 text-slate-400" />
          <input
            type="search"
            aria-label="Search patients"
            placeholder="Search ID, condition, status"
            className={`${inputClass} pl-8`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      }
    >
      {patients.length === 0 ? (
        <EmptyState>No patients yet. Add one above or choose “Load examples”.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>No patients match “{query}”.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-600 uppercase">
              <tr>
                {["Patient ID", "Condition", "Arrival", "Urgency", "Treatment", "Required resources", "Status", "Priority", "Created", ""].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.id} className={p.status === "cancelled" ? "text-slate-400" : undefined}>
                  <th scope="row" className="px-2 py-2 font-semibold">
                    {p.patient_id}
                    {p.appointment && (
                      <Badge tone="blue" className="ml-1.5 align-middle">
                        Appt
                      </Badge>
                    )}
                    {p.alert_time != null && (
                      <Badge tone="red" className="ml-1.5 align-middle">
                        Amb
                      </Badge>
                    )}
                  </th>
                  <td className="px-2 py-2">{p.condition}</td>
                  <td className="px-2 py-2 tabular-nums">{p.arrival_time} min</td>
                  <td className="px-2 py-2">
                    <Badge tone={p.urgency >= 4 ? "red" : p.urgency === 3 ? "yellow" : "grey"}>{p.urgency}</Badge>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{p.treatment_time} min</td>
                  <td className="px-2 py-2 text-xs">{resourceSummary(p)}</td>
                  <td className="px-2 py-2">{statusBadge(p.status)}</td>
                  <td className="px-2 py-2 tabular-nums">{p.priority_score.toFixed(1)}</td>
                  <td className="px-2 py-2 text-xs whitespace-nowrap text-slate-600">{new Date(p.created_at).toLocaleString()}</td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1">
                      {p.status !== "cancelled" && p.status !== "treated" && (
                        <Button variant="ghost" className="!px-2 !py-1" aria-label={`Cancel patient ${p.patient_id}`} title="Cancel (exclude from simulations)" onClick={() => void cancelPatient(p.patient_id)}>
                          <XCircle size={16} aria-hidden />
                        </Button>
                      )}
                      <Button variant="ghost" className="!px-2 !py-1 text-red-700" aria-label={`Delete patient ${p.patient_id}`} title="Delete" onClick={() => void deletePatient(p.patient_id)}>
                        <Trash2 size={16} aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
