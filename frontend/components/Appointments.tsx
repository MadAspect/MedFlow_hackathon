"use client";

import { CalendarClock, CalendarPlus, Check, FlaskConical, Trash2, Wand2, XCircle } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Notice, cx, inputClass, type Tone } from "./ui";
import { CONDITIONS } from "@/lib/constants";
import type { PatientRow } from "@/lib/database";
import { useStore } from "@/lib/store";
import {
  APPOINTMENT_GRACE,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  bookedDemandAt,
  checkSlot,
  slotLabel,
  suggestSlot,
  type Booking,
  type ResourceKey,
  type ResourceSet,
} from "@/lib/simulation";
import { parseNumberField, validateAppointment, type FieldErrors } from "@/lib/validation";

const URGENCY_LABELS = ["1 – Low", "2 – Minor", "3 – Moderate", "4 – High", "5 – Critical"];

function bookingsOf(patients: PatientRow[]): Booking[] {
  return patients
    .filter((p) => p.appointment && p.status !== "cancelled")
    .map((p) => ({ id: p.patient_id, start: p.arrival_time, duration: p.treatment_time, need: p.required_resources }));
}

function nextId(ids: string[]): string {
  const taken = new Set(ids.map((i) => i.toLowerCase()));
  let n = 1;
  while (taken.has(`a${String(n).padStart(3, "0")}`)) n++;
  return `A${String(n).padStart(3, "0")}`;
}

const resourceSummary = (need: PatientRow["required_resources"]) =>
  RESOURCE_KEYS.filter((k) => need[k])
    .map((k) => `${RESOURCE_LABELS[k]} ×${need[k]}`)
    .join(", ");

export function AppointmentForm() {
  const { patients, resources, addPatient, loadExampleAppointments } = useStore();
  const [patientId, setPatientId] = useState("");
  const [slot, setSlot] = useState("30");
  const [urgency, setUrgency] = useState("2");
  const [treatment, setTreatment] = useState("20");
  const [condition, setCondition] = useState<string>(CONDITIONS[0]);
  const [needs, setNeeds] = useState<Partial<Record<ResourceKey, number>>>({ doctor: 1 });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [booked, setBooked] = useState(false);
  const [busy, setBusy] = useState(false);

  const bookings = useMemo(() => bookingsOf(patients), [patients]);
  const slotMin = parseNumberField(slot);
  const duration = parseNumberField(treatment);
  const inputsOk = Number.isInteger(slotMin) && slotMin >= 0 && Number.isInteger(duration) && duration > 0;
  const hasNeeds = RESOURCE_KEYS.some((k) => (needs[k] ?? 0) > 0);

  const check = useMemo(
    () => (inputsOk && hasNeeds ? checkSlot(bookings, { id: "", start: slotMin, duration, need: needs }, resources) : null),
    [bookings, slotMin, duration, needs, resources, inputsOk, hasNeeds],
  );
  const suggestion = useMemo(
    () => (inputsOk && hasNeeds ? suggestSlot(bookings, needs, duration, resources, slotMin) : null),
    [bookings, slotMin, duration, needs, resources, inputsOk, hasNeeds],
  );

  const toggle = (key: ResourceKey, on: boolean) =>
    setNeeds((prev) => {
      const next = { ...prev };
      if (on) next[key] = next[key] || 1;
      else delete next[key];
      return next;
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = validateAppointment(
      {
        patient_id: patientId.trim() === "" ? nextId(patients.map((p) => p.patient_id)) : patientId,
        condition,
        arrival_time: slotMin,
        urgency: parseNumberField(urgency),
        treatment_time: duration,
        required_resources: needs,
      },
      patients.map((p) => p.patient_id),
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (check && check.impossible.length > 0) {
      setErrors({ required_resources: "The hospital does not have enough of this resource, so it could never be treated." });
      return;
    }
    setErrors({});
    setBusy(true);
    const ok = await addPatient(result.data);
    setBusy(false);
    if (ok) {
      setBooked(true);
      window.setTimeout(() => setBooked(false), 1800);
      setPatientId("");
    }
  }

  const err = (k: string) => errors[k];
  const a11y = (k: string) => ({ "aria-invalid": err(k) ? true : undefined, "aria-describedby": err(k) ? `${k}-error` : undefined });

  return (
    <Card
      title="Book an appointment"
      description={`Minute 0 is ${slotLabel(0)}. A booked slot is protected: it should start within ${APPOINTMENT_GRACE} minutes.`}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Appointment ID" htmlFor="patient_id" error={err("patient_id")} hint="Leave empty to use the next free ID">
            <input id="patient_id" className={inputClass} value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder={nextId(patients.map((p) => p.patient_id))} maxLength={32} {...a11y("patient_id")} />
          </Field>
          <Field label="Condition" htmlFor="condition" error={err("condition")}>
            <select id="condition" className={inputClass} value={condition} onChange={(e) => setCondition(e.target.value)} {...a11y("condition")}>
              {CONDITIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Urgency" htmlFor="urgency" error={err("urgency")} hint="Planned visits are usually 1–3">
            <select id="urgency" className={inputClass} value={urgency} onChange={(e) => setUrgency(e.target.value)} {...a11y("urgency")}>
              {URGENCY_LABELS.map((label, i) => (
                <option key={label} value={i + 1}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Slot (minutes from start)" htmlFor="slot" error={err("slot")} hint={inputsOk ? `= ${slotLabel(slotMin)}` : "Whole minutes, 0 or more"}>
            <input id="slot" type="number" inputMode="numeric" className={inputClass} value={slot} onChange={(e) => setSlot(e.target.value)} {...a11y("slot")} />
          </Field>
          <Field label="Treatment time (min)" htmlFor="treatment_time" error={err("treatment_time")} hint={inputsOk ? `ends ${slotLabel(slotMin + duration)}` : undefined}>
            <input id="treatment_time" type="number" inputMode="numeric" className={inputClass} value={treatment} onChange={(e) => setTreatment(e.target.value)} {...a11y("treatment_time")} />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-800">Required resources</legend>
          <div className="flex flex-wrap gap-2">
            {RESOURCE_KEYS.map((key) => {
              const on = needs[key] !== undefined;
              return (
                <div key={key} className={cx("flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm", on ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-surface")}>
                  <input id={`apt-res-${key}`} type="checkbox" checked={on} onChange={(e) => toggle(key, e.target.checked)} className="h-4 w-4 accent-blue-700" />
                  <label htmlFor={`apt-res-${key}`}>{RESOURCE_LABELS[key]}</label>
                  {on && (
                    <input
                      aria-label={`${RESOURCE_LABELS[key]} units needed`}
                      type="number"
                      min={1}
                      max={20}
                      value={needs[key]}
                      onChange={(e) => setNeeds((p) => ({ ...p, [key]: Math.max(1, Math.floor(Number(e.target.value) || 1)) }))}
                      className="w-14 rounded border border-slate-300 px-1.5 py-0.5 text-sm"
                    />
                  )}
                </div>
              );
            })}
          </div>
          {err("required_resources") && <p className="mt-1 text-xs font-medium text-red-700">{err("required_resources")}</p>}
        </fieldset>

        <SlotNotice check={check} suggestion={suggestion} slotMin={slotMin} resources={resources} onUseSlot={(m) => setSlot(String(m))} />

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy} className={cx(booked && "!bg-emerald-600 !border-emerald-600")}>
            {booked ? <Check size={16} aria-hidden /> : <CalendarPlus size={16} aria-hidden />}
            {booked ? "Booked" : "Book appointment"}
          </Button>
          <Button variant="secondary" onClick={() => void loadExampleAppointments()}>
            <FlaskConical size={16} aria-hidden /> Load examples
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SlotNotice({
  check,
  suggestion,
  slotMin,
  resources,
  onUseSlot,
}: {
  check: ReturnType<typeof checkSlot> | null;
  suggestion: number | null;
  slotMin: number;
  resources: ResourceSet;
  onUseSlot: (minute: number) => void;
}) {
  if (!check) return <p className="text-xs text-slate-500">Enter a slot, a treatment time and at least one resource to check availability.</p>;

  if (check.impossible.length > 0) {
    return (
      <Notice tone="red">
        <strong>Cannot be treated.</strong>{" "}
        {check.impossible.map((i) => `It needs ${i.needed} ${RESOURCE_LABELS[i.resource].toLowerCase()} but the hospital has ${i.capacity}.`).join(" ")} Change what it needs, or add capacity on the
        Resources page.
      </Notice>
    );
  }

  if (check.overbooked) {
    const o = check.overbooked;
    return (
      <Notice tone="yellow">
        <strong>Overbooked at {slotLabel(o.minute)}.</strong> The appointments already booked plus this one need {o.demand} {RESOURCE_LABELS[o.resource].toLowerCase()} at the same time, and
        the hospital has {o.capacity}. It would probably start late.{" "}
        {suggestion !== null && suggestion !== slotMin && (
          <button type="button" onClick={() => onUseSlot(suggestion)} className="inline-flex items-center gap-1 font-semibold text-blue-800 underline underline-offset-2">
            <Wand2 size={13} aria-hidden /> Use the next free slot, {slotLabel(suggestion)}
          </button>
        )}
      </Notice>
    );
  }

  const others = check.overlapping.length;
  const owned = RESOURCE_KEYS.filter((k) => resources[k] > 0)
    .map((k) => `${RESOURCE_LABELS[k]} ${resources[k]}`)
    .join(", ");
  return (
    <Notice tone="green">
      <strong>Slot is free.</strong>{" "}
      {others === 0 ? "No other appointment overlaps it." : `${others} other appointment${others === 1 ? " overlaps" : "s overlap"} it, and the hospital (${owned}) has room for all of them.`} Walk-ins
      are not known in advance, so they are not counted here.
    </Notice>
  );
}

export function BookedLoad() {
  const { patients, resources } = useStore();
  const bookings = useMemo(() => bookingsOf(patients), [patients]);

  const blocks = useMemo(() => {
    if (bookings.length === 0) return [];
    const end = Math.max(...bookings.map((b) => b.start + b.duration));
    const count = Math.max(8, Math.ceil(end / 15));
    return Array.from({ length: count }, (_, i) => {
      let peak = 0;
      for (let m = i * 15; m < (i + 1) * 15; m++) {
        const demand = bookedDemandAt(bookings, m);
        for (const k of RESOURCE_KEYS) {
          if (demand[k] > 0) peak = Math.max(peak, resources[k] > 0 ? demand[k] / resources[k] : 2);
        }
      }
      return { start: i * 15, peak };
    });
  }, [bookings, resources]);

  if (blocks.length === 0) return null;
  const busiest = blocks.reduce((a, b) => (b.peak > a.peak ? b : a));
  const tone = (peak: number) => (peak > 1 ? "bg-red-500" : peak >= 0.7 ? "bg-amber-400" : peak > 0 ? "bg-emerald-500" : "bg-slate-200");

  return (
    <Card title="Booked load" description="Booked demand per 15 minutes. Red means more is booked than the hospital has.">
      <div role="img" aria-label={`Booked load per 15 minutes. Busiest block starts at ${slotLabel(busiest.start)} at ${Math.round(busiest.peak * 100)} percent of capacity.`}>
        <div className="flex h-24 items-end gap-0.5" aria-hidden>
          {blocks.map((b) => (
            <div key={b.start} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${slotLabel(b.start)}: ${Math.round(b.peak * 100)}% of capacity booked`}>
              <div className={cx("w-full rounded-t-sm transition-[height]", tone(b.peak))} style={{ height: `${Math.max(b.peak > 0 ? 6 : 2, Math.min(1, b.peak) * 100)}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-slate-500 tabular-nums" aria-hidden>
          <span>{slotLabel(0)}</span>
          <span>{slotLabel(Math.round((blocks.length * 15) / 2))}</span>
          <span>{slotLabel(blocks.length * 15)}</span>
        </div>
      </div>
    </Card>
  );
}

export function AppointmentList() {
  const { patients, current, deletePatient, cancelPatient } = useStore();
  const rows = useMemo(
    () => patients.filter((p) => p.appointment).sort((a, b) => a.arrival_time - b.arrival_time || a.patient_id.localeCompare(b.patient_id)),
    [patients],
  );

  const outcomeFor = (p: PatientRow): { label: string; tone: Tone } => {
    if (p.status === "cancelled") return { label: "Cancelled", tone: "grey" };
    const o = current?.output.patients.find((x) => x.id === p.patient_id);
    if (!o) return { label: "Not simulated yet", tone: "grey" };
    if (o.status !== "treated") return { label: "Not treated", tone: "red" };
    return o.wait_time <= APPOINTMENT_GRACE ? { label: "On time", tone: "green" } : { label: `${o.wait_time} min late`, tone: "yellow" };
  };

  return (
    <Card
      title={`Booked appointments (${rows.filter((p) => p.status !== "cancelled").length})`}
      description={
        <>
          Every booked appointment is part of the next simulation.{" "}
          <Link href="/simulation" className="font-medium text-blue-700 underline underline-offset-2">
            Run it on the Simulation page
          </Link>{" "}
          to see who is on time.
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState>No appointments yet. Book one above or choose “Load examples”.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-600 uppercase">
              <tr>
                {["Slot", "ID", "Condition", "Urgency", "Treatment", "Required resources", "Last simulation", ""].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => {
                const outcome = outcomeFor(p);
                return (
                  <tr key={p.id} className={p.status === "cancelled" ? "text-slate-400" : undefined}>
                    <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                      <CalendarClock size={13} aria-hidden className="mr-1 inline text-blue-700" />
                      {slotLabel(p.arrival_time)} <span className="text-xs text-slate-500">· min {p.arrival_time}</span>
                    </td>
                    <th scope="row" className="px-2 py-2 font-semibold">{p.patient_id}</th>
                    <td className="px-2 py-2">{p.condition}</td>
                    <td className="px-2 py-2">
                      <Badge tone={p.urgency >= 4 ? "red" : p.urgency === 3 ? "yellow" : "grey"}>{p.urgency}</Badge>
                    </td>
                    <td className="px-2 py-2 tabular-nums">{p.treatment_time} min</td>
                    <td className="px-2 py-2 text-xs">{resourceSummary(p.required_resources)}</td>
                    <td className="px-2 py-2">
                      <Badge tone={outcome.tone}>{outcome.label}</Badge>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        {p.status !== "cancelled" && p.status !== "treated" && (
                          <Button variant="ghost" className="!px-2 !py-1" aria-label={`Cancel appointment ${p.patient_id}`} title="Cancel (exclude from simulations)" onClick={() => void cancelPatient(p.patient_id)}>
                            <XCircle size={16} aria-hidden />
                          </Button>
                        )}
                        <Button variant="ghost" className="!px-2 !py-1 text-red-700" aria-label={`Delete appointment ${p.patient_id}`} title="Delete" onClick={() => void deletePatient(p.patient_id)}>
                          <Trash2 size={16} aria-hidden />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
