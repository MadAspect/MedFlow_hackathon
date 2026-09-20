"use client";

import Link from "next/link";
import { Badge, Card, cx } from "./ui";
import { useStore } from "@/lib/store";
import { equipmentLow, equipmentStatus, stockWarnings } from "@/lib/inventory";
import { isInbound, slotLabel } from "@/lib/simulation";
import { ROLE_LABEL, STATUS_LABEL, alignRoster, summarizeStaff } from "@/lib/staff";

const more = (label: string, href: string) => (
  <Link href={href} className="text-[13px] font-medium text-blue-700 hover:text-blue-700">
    {label} →
  </Link>
);

/** Staffing, stock, equipment, ambulances and appointments at the minute being watched. */
export function OperationsOverview() {
  const { medicines, equipment, staff, resources, current, viewTime, stockEnabled } = useStore();
  const output = current && !current.output.isPlaceholder ? current.output : null;
  const t = output ? Math.min(viewTime, Math.max(0, output.timeline.length - 1)) : 0;

  // Doctors and nurses are counted from the Resources page, so this card agrees with it.
  const { scheduled } = alignRoster(staff, resources);
  const summary = summarizeStaff(scheduled);
  const away = scheduled.filter((s) => s.availability_status !== "available");
  const warnings = stockWarnings(medicines, equipment);
  const critical = warnings.filter((w) => w.level === "critical").length;

  const appointments = output ? output.patients.filter((p) => p.appointment && p.arrival_time > t).sort((a, b) => a.arrival_time - b.arrival_time) : [];
  const inbound = output ? output.patients.filter((p) => p.ambulance && p.alert_time != null && isInbound({ arrival_time: p.arrival_time, alert_time: p.alert_time }, t)) : [];
  const held = output?.stock ? [...output.stock.medicines, ...output.stock.equipment].filter((i) => i.blocked_patients > 0) : [];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Staff availability" actions={more("Manage", "/staff")}>
        {scheduled.length === 0 ? (
          <p className="text-sm text-slate-500">No staff listed yet.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              <span className="text-2xl font-semibold tabular-nums">{summary.available}</span>
              <span className="text-slate-500"> of {summary.total} available</span>
            </p>
            <ul className="space-y-1 text-xs text-slate-600">
              <li>
                {ROLE_LABEL.doctor}s: {summary.byRole.doctor.available}/{summary.byRole.doctor.total}
              </li>
              <li>
                {ROLE_LABEL.nurse}s: {summary.byRole.nurse.available}/{summary.byRole.nurse.total}
              </li>
            </ul>
            {away.length > 0 && (
              <ul className="space-y-1" aria-label="Staff not available">
                {away.slice(0, 4).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                    <span>{s.name}</span>
                    <Badge tone={s.availability_status === "unavailable" ? "red" : "yellow"}>{STATUS_LABEL[s.availability_status]}</Badge>
                  </li>
                ))}
                {away.length > 4 && <li className="text-xs text-slate-500">and {away.length - 4} more</li>}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Card title="Stock and equipment" actions={more("Inventory", "/inventory")}>
        {medicines.length + equipment.length === 0 ? (
          <p className="text-sm text-slate-500">No inventory listed yet.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p className={cx("text-xs font-medium", critical > 0 ? "text-red-700" : warnings.length > 0 ? "text-amber-700" : "text-emerald-700")}>
              {warnings.length === 0 ? "All stock above its minimum." : `${warnings.length} stock warning${warnings.length === 1 ? "" : "s"}${critical > 0 ? `, ${critical} critical` : ""}.`}
            </p>
            {warnings.length > 0 && (
              <ul className="space-y-1 text-xs" aria-label="Low-stock warnings">
                {warnings.slice(0, 3).map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
            )}
            <ul className="space-y-1 text-xs" aria-label="Equipment availability">
              {equipment.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2">
                  <span>{e.name}</span>
                  <span className="flex items-center gap-1.5 tabular-nums">
                    {e.available_quantity}/{e.quantity}
                    <Badge tone={equipmentStatus(e) === "unavailable" ? "red" : equipmentLow(e) ? "yellow" : "green"}>
                      {equipmentStatus(e) === "unavailable" ? (e.maintenance_status === "maintenance" ? "Maintenance" : "None free") : equipmentLow(e) ? "Low" : "OK"}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
            {stockEnabled && held.length > 0 && (
              <p className="text-xs text-amber-700">Held patients back in this run: {held.map((i) => i.name).join(", ")}.</p>
            )}
          </div>
        )}
      </Card>

      <Card title="Arriving soon" actions={more("Appointments", "/appointments")}>
        {!output ? (
          <p className="text-sm text-slate-500">Run a simulation to see who is due.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-semibold text-slate-700">Ambulances on the way ({inbound.length})</p>
              {inbound.length === 0 ? (
                <p className="text-xs text-slate-500">None inbound at {slotLabel(t)}.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-xs">
                  {inbound.map((p) => (
                    <li key={p.id}>
                      {p.id} · {p.condition} · arrives in {p.arrival_time - t} min
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-700">Upcoming appointments ({appointments.length})</p>
              {appointments.length === 0 ? (
                <p className="text-xs text-slate-500">None still to come.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-xs">
                  {appointments.slice(0, 4).map((p) => (
                    <li key={p.id}>
                      {p.id} · {slotLabel(p.arrival_time)} · {p.condition}
                    </li>
                  ))}
                  {appointments.length > 4 && <li className="text-slate-500">and {appointments.length - 4} more</li>}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
