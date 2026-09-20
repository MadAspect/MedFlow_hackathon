"use client";

import { Pencil, Plus, Search, Trash2, UserCheck, UserX } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Notice, Stat, inputClass, type Tone } from "./ui";
import { useStore } from "@/lib/store";
import { slotLabel } from "@/lib/simulation";
import {
  AVAILABILITY_STATUSES,
  ROLE_LABEL,
  STAFF_ROLES,
  STATUS_LABEL,
  alignRoster,
  assignmentsAt,
  filterStaff,
  isAssignable,
  isOpenSlot,
  summarizeStaff,
  type AvailabilityStatus,
  type StaffMember,
  type StaffRole,
} from "@/lib/staff";

const STATUS_TONE: Record<AvailabilityStatus, Tone> = {
  available: "green",
  busy: "yellow",
  on_leave: "blue",
  unavailable: "red",
  training: "grey",
};

const EMPTY_FORM = { name: "", role: "doctor" as StaffRole, department: "", specialization: "", shift_start: "08:00", shift_end: "20:00" };

function StaffForm({ editing, onDone }: { editing: StaffMember | null; onDone: () => void }) {
  const { saveStaffMember } = useStore();
  const [f, setF] = useState(
    editing
      ? { name: editing.name, role: editing.role, department: editing.department, specialization: editing.specialization ?? "", shift_start: editing.shift_start, shift_end: editing.shift_end }
      : EMPTY_FORM,
  );
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await saveStaffMember({ ...f, specialization: f.specialization || null }, editing?.id);
    setBusy(false);
    if (ok) {
      setF(EMPTY_FORM);
      onDone();
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={editing ? "Edit staff member" : "Add staff member"} className="grid items-end gap-3 sm:grid-cols-3 lg:grid-cols-7">
      <Field label="Name" htmlFor="st_name">
        <input id="st_name" className={inputClass} value={f.name} onChange={set("name")} maxLength={80} />
      </Field>
      <Field label="Role" htmlFor="st_role">
        <select id="st_role" className={inputClass} value={f.role} onChange={set("role")}>
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Department" htmlFor="st_department">
        <input id="st_department" className={inputClass} value={f.department} onChange={set("department")} maxLength={40} />
      </Field>
      <Field label="Specialization" htmlFor="st_spec">
        <input id="st_spec" className={inputClass} value={f.specialization} onChange={set("specialization")} maxLength={60} />
      </Field>
      <Field label="Shift start" htmlFor="st_start">
        <input id="st_start" type="time" className={inputClass} value={f.shift_start} onChange={set("shift_start")} />
      </Field>
      <Field label="Shift end" htmlFor="st_end">
        <input id="st_end" type="time" className={inputClass} value={f.shift_end} onChange={set("shift_end")} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {editing ? <Pencil size={16} aria-hidden /> : <Plus size={16} aria-hidden />} {editing ? "Save" : "Add staff"}
        </Button>
        {editing && (
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function StaffRoster() {
  const { staff, staffEvents, resources, current, viewTime, setAvailability, removeStaff, loadExampleStaff } = useStore();
  const [role, setRole] = useState("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState<StaffMember | null>(null);

  const output = current && !current.output.isPlaceholder ? current.output : null;
  const minute = output ? Math.round(Math.min(viewTime, Math.max(0, output.timeline.length - 1))) : 0;
  // The number of doctors and nurses comes from the Resources page; the roster names those units.
  const { scheduled, surplus } = useMemo(() => alignRoster(staff, resources), [staff, resources]);
  const everyone = useMemo(() => [...scheduled, ...surplus], [scheduled, surplus]);
  const notScheduled = useMemo(() => new Set(surplus.map((s) => s.id)), [surplus]);
  const summary = useMemo(() => summarizeStaff(scheduled), [scheduled]);
  const rows = useMemo(() => filterStaff(everyone, { role, department, status, query }), [everyone, role, department, status, query]);
  const assignments = useMemo(() => (output ? assignmentsAt(output.patients, scheduled, minute) : new Map<string, string[]>()), [output, scheduled, minute]);
  const departments = [...new Set(everyone.filter((s) => !isOpenSlot(s)).map((s) => s.department))].sort();
  const names = new Map(everyone.map((s) => [s.id, s.name]));
  const open = scheduled.filter(isOpenSlot).length;
  const surplusOf = (r: "doctor" | "nurse") => surplus.filter((s) => s.role === r).length;

  return (
    <div className="space-y-5">
      <Notice tone="blue">
        Doctors and nurses come from the{" "}
        <Link href="/resources" className="font-medium underline">
          Resources page
        </Link>
        : <strong>{resources.doctor} doctors</strong> and <strong>{resources.nurse} nurses</strong>. Change the numbers there and this list follows.
        {open > 0 && ` ${open} of those positions have nobody named yet; use the pencil to name one.`}
        {surplusOf("doctor") + surplusOf("nurse") > 0 &&
          ` ${surplusOf("doctor")} doctors and ${surplusOf("nurse")} nurses listed here are beyond that number, so they are not scheduled until you raise it.`}
      </Notice>

      <Notice tone="blue">
        {output ? (
          <>
            Availability changes take effect at <strong>minute {minute} ({slotLabel(minute)})</strong>, the minute you are watching, and the run is recalculated from there. Treatments that have already started are never changed. Doctors and nurses who are not available are left out of every new assignment.
          </>
        ) : (
          <>Availability changes apply to the next simulation you run. Doctors and nurses who are not available are left out of every new assignment.</>
        )}
      </Notice>

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Staff" value={summary.total} sub={`${summary.byRole.doctor.total} doctors, ${summary.byRole.nurse.total} nurses`} />
        <Stat label="Available" value={summary.available} tone="green" sub={`${summary.byRole.doctor.available} doctors, ${summary.byRole.nurse.available} nurses`} />
        <Stat label="Busy" value={summary.busy} tone={summary.busy > 0 ? "yellow" : undefined} />
        <Stat label="On leave" value={summary.onLeave} />
        <Stat label="Unavailable" value={summary.unavailable} tone={summary.unavailable > 0 ? "red" : undefined} />
        <Stat label="Training" value={summary.training} />
      </div>

      <Card
        title={editing ? `Edit ${editing.name}` : "Add staff"}
        actions={
          <Button variant="secondary" onClick={() => void loadExampleStaff()}>
            Load example staff
          </Button>
        }
      >
        <StaffForm key={editing?.id ?? "new"} editing={editing} onDone={() => setEditing(null)} />
      </Card>

      <Card title={`Faculty and medical staff (${rows.length})`}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search size={16} aria-hidden className="absolute top-2.5 left-2.5 text-slate-400" />
            <input type="search" aria-label="Search staff" placeholder="Search name or specialization" className={`${inputClass} pl-8`} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select aria-label="Filter by role" className={`${inputClass} !w-40`} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">All roles</option>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <select aria-label="Filter by department" className={`${inputClass} !w-44`} value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <select aria-label="Filter by status" className={`${inputClass} !w-40`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {AVAILABILITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <input aria-label="Reason for the next change" placeholder="Reason for next change (optional)" className={`${inputClass} !w-64`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} />
        </div>

        {everyone.length === 0 ? (
          <EmptyState>No staff yet. Add someone above or choose “Load example staff”.</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>No staff match the filters.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-600 uppercase">
                <tr>
                  {["Name", "Role", "Department", "Shift", "Status", "Change availability", "Current assignment", ""].map((h) => (
                    <th key={h} scope="col" className="px-2 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((s) => {
                  const now = assignments.get(s.id);
                  return (
                    <tr key={s.id}>
                      <th scope="row" className="px-2 py-2 font-semibold">
                        {s.name}
                        {isOpenSlot(s) && <span className="block text-xs font-normal text-slate-500">Open position from Resources, nobody named yet</span>}
                        {notScheduled.has(s.id) && <span className="block text-xs font-normal text-amber-700">Beyond the Resources headcount, not scheduled</span>}
                        {s.specialization && <span className="block text-xs font-normal text-slate-500">{s.specialization}</span>}
                      </th>
                      <td className="px-2 py-2">{ROLE_LABEL[s.role]}</td>
                      <td className="px-2 py-2">{isOpenSlot(s) ? "–" : s.department}</td>
                      <td className="px-2 py-2 whitespace-nowrap tabular-nums">{isOpenSlot(s) ? "–" : `${s.shift_start}–${s.shift_end}`}</td>
                      <td className="px-2 py-2">
                        <Badge tone={STATUS_TONE[s.availability_status]}>{STATUS_LABEL[s.availability_status]}</Badge>
                      </td>
                      <td className="px-2 py-2">
                        <span className="flex items-center gap-1.5">
                          <select
                            aria-label={`Availability for ${s.name}`}
                            className={`${inputClass} !h-8 !w-40`}
                            value={s.availability_status}
                            onChange={(e) => void setAvailability(s.id, e.target.value as AvailabilityStatus, reason)}
                          >
                            {AVAILABILITY_STATUSES.map((a) => (
                              <option key={a} value={a}>
                                {STATUS_LABEL[a]}
                              </option>
                            ))}
                          </select>
                          {isAssignable(s) ? (
                            <Button variant="secondary" size="sm" onClick={() => void setAvailability(s.id, "unavailable", reason)}>
                              <UserX size={14} aria-hidden /> Mark unavailable
                            </Button>
                          ) : (
                            <Button variant="secondary" size="sm" onClick={() => void setAvailability(s.id, "available", reason)}>
                              <UserCheck size={14} aria-hidden /> Mark available
                            </Button>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {notScheduled.has(s.id) ? (
                          <span className="text-slate-400">–</span>
                        ) : now ? (
                          <span>
                            With {now.join(", ")}
                            {!isAssignable(s) && <span className="block text-amber-700">Finishing; no new assignments</span>}
                          </span>
                        ) : output && (s.role === "doctor" || s.role === "nurse") ? (
                          <span className="text-slate-500">{isAssignable(s) ? "Free" : "Off the schedule"}</span>
                        ) : (
                          <span className="text-slate-400">–</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex gap-1">
                          <Button variant="ghost" className="!px-2 !py-1" aria-label={`Edit ${s.name}`} title={isOpenSlot(s) ? "Name this position" : "Edit details"} onClick={() => setEditing(s)}>
                            <Pencil size={16} aria-hidden />
                          </Button>
                          {!isOpenSlot(s) && (
                            <Button variant="ghost" className="!px-2 !py-1 text-red-700" aria-label={`Remove ${s.name}`} title="Remove" onClick={() => void removeStaff(s.id)}>
                              <Trash2 size={16} aria-hidden />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {output && (
          <p className="mt-3 text-xs text-slate-500">
            “Current assignment” is shown for minute {minute}: the simulation counts doctors and nurses rather than tracking individuals, so people are matched to the treatments in progress in ID order.
          </p>
        )}
      </Card>

      <Card title="Availability history" description="Every change, newest first. “From minute” is the simulation minute it took effect.">
        {staffEvents.length === 0 ? (
          <EmptyState>No availability changes yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm" aria-label="Availability history">
            {staffEvents.slice(0, 12).map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-medium">{names.get(ev.staff_id) ?? ev.staff_id}</span>
                <span className="text-slate-600">
                  {STATUS_LABEL[ev.previous_status]} → {STATUS_LABEL[ev.new_status]}
                </span>
                <span className="text-xs text-slate-500">from minute {ev.effective_time}</span>
                {ev.reason && <span className="text-xs text-slate-500">“{ev.reason}”</span>}
                <span className="ml-auto text-xs text-slate-400">{new Date(ev.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
