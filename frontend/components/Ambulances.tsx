"use client";

import { Ambulance, Check, FlaskConical, Trash2, XCircle } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Notice, cx, inputClass, type Tone } from "./ui";
import { CONDITIONS } from "@/lib/constants";
import type { PatientRow } from "@/lib/database";
import { useStore } from "@/lib/store";
import {
  AMBULANCE_GRACE,
  MAX_AMBULANCE_MINUTES,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  slotLabel,
  type ResourceKey,
} from "@/lib/simulation";
import { parseNumberField, validateAmbulance, type FieldErrors } from "@/lib/validation";

const URGENCY_LABELS = ["1 – Low", "2 – Minor", "3 – Moderate", "4 – High", "5 – Critical"];

function nextId(ids: string[]): string {
  const taken = new Set(ids.map((i) => i.toLowerCase()));
  let n = 1;
  while (taken.has(`m${String(n).padStart(3, "0")}`)) n++;
  return `M${String(n).padStart(3, "0")}`;
}

const resourceSummary = (need: PatientRow["required_resources"]) =>
  RESOURCE_KEYS.filter((k) => need[k])
    .map((k) => `${RESOURCE_LABELS[k]} ×${need[k]}`)
    .join(", ");

export function AmbulanceForm() {
  const { patients, resources, addPatient, loadExampleAmbulances } = useStore();
  const [patientId, setPatientId] = useState("");
  const [dispatch, setDispatch] = useState("20");
  const [eta, setEta] = useState("12");
  const [urgency, setUrgency] = useState("4");
  const [treatment, setTreatment] = useState("30");
  const [condition, setCondition] = useState<string>(CONDITIONS[0]);
  const [needs, setNeeds] = useState<Partial<Record<ResourceKey, number>>>({ doctor: 1 });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [logged, setLogged] = useState(false);
  const [busy, setBusy] = useState(false);

  const dispatchMin = parseNumberField(dispatch);
  const etaMin = parseNumberField(eta);
  const timingOk = Number.isInteger(dispatchMin) && dispatchMin >= 0 && Number.isInteger(etaMin) && etaMin >= 1;
  const tooBig = RESOURCE_KEYS.filter((k) => (needs[k] ?? 0) > resources[k]);

  const toggle = (key: ResourceKey, on: boolean) =>
    setNeeds((prev) => {
      const next = { ...prev };
      if (on) next[key] = next[key] || 1;
      else delete next[key];
      return next;
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = validateAmbulance(
      {
        patient_id: patientId.trim() === "" ? nextId(patients.map((p) => p.patient_id)) : patientId,
        condition,
        dispatch_time: dispatchMin,
        eta: etaMin,
        urgency: parseNumberField(urgency),
        treatment_time: parseNumberField(treatment),
        required_resources: needs,
      },
      patients.map((p) => p.patient_id),
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (tooBig.length > 0) {
      setErrors({ required_resources: "The hospital does not have enough of this resource, so it could never be treated." });
      return;
    }
    setErrors({});
    setBusy(true);
    const ok = await addPatient(result.data);
    setBusy(false);
    if (ok) {
      setLogged(true);
      window.setTimeout(() => setLogged(false), 1800);
      setPatientId("");
    }
  }

  const err = (k: string) => errors[k];
  const a11y = (k: string) => ({ "aria-invalid": err(k) ? true : undefined, "aria-describedby": err(k) ? `${k}-error` : undefined });

  return (
    <Card
      title="Log an inbound ambulance"
      description={`Minute 0 is ${slotLabel(0)}. The hospital is warned at the dispatch and holds the resources the patient needs, so they can start within ${AMBULANCE_GRACE} minutes of arriving.`}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Ambulance patient ID" htmlFor="patient_id" error={err("patient_id")} hint="Leave empty to use the next free ID">
            <input id="patient_id" className={inputClass} value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder={nextId(patients.map((p) => p.patient_id))} maxLength={32} {...a11y("patient_id")} />
          </Field>
          <Field label="Condition" htmlFor="condition" error={err("condition")}>
            <select id="condition" className={inputClass} value={condition} onChange={(e) => setCondition(e.target.value)} {...a11y("condition")}>
              {CONDITIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Urgency (paramedic estimate)" htmlFor="urgency" error={err("urgency")}>
            <select id="urgency" className={inputClass} value={urgency} onChange={(e) => setUrgency(e.target.value)} {...a11y("urgency")}>
              {URGENCY_LABELS.map((label, i) => (
                <option key={label} value={i + 1}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Dispatch: hospital warned at (min)" htmlFor="dispatch_time" error={err("dispatch_time")} hint={timingOk ? `= ${slotLabel(dispatchMin)}` : "Whole minutes, 0 or more"}>
            <input id="dispatch_time" type="number" inputMode="numeric" className={inputClass} value={dispatch} onChange={(e) => setDispatch(e.target.value)} {...a11y("dispatch_time")} />
          </Field>
          <Field
            label="Travel time / ETA (min)"
            htmlFor="eta"
            error={err("eta")}
            hint={timingOk ? `reaches the hospital at minute ${dispatchMin + etaMin} (${slotLabel(dispatchMin + etaMin)})` : `1 to ${MAX_AMBULANCE_MINUTES} minutes`}
          >
            <input id="eta" type="number" inputMode="numeric" className={inputClass} value={eta} onChange={(e) => setEta(e.target.value)} {...a11y("eta")} />
          </Field>
          <Field label="Treatment time (min)" htmlFor="treatment_time" error={err("treatment_time")}>
            <input id="treatment_time" type="number" inputMode="numeric" className={inputClass} value={treatment} onChange={(e) => setTreatment(e.target.value)} {...a11y("treatment_time")} />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-800">Resources to hold for arrival</legend>
          <div className="flex flex-wrap gap-2">
            {RESOURCE_KEYS.map((key) => {
              const on = needs[key] !== undefined;
              return (
                <div key={key} className={cx("flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm", on ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-surface")}>
                  <input id={`amb-res-${key}`} type="checkbox" checked={on} onChange={(e) => toggle(key, e.target.checked)} className="h-4 w-4 accent-blue-700" />
                  <label htmlFor={`amb-res-${key}`}>{RESOURCE_LABELS[key]}</label>
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

        {tooBig.length > 0 && (
          <Notice tone="red">
            <strong>Cannot be treated.</strong>{" "}
            {tooBig.map((k) => `It needs ${needs[k]} ${RESOURCE_LABELS[k].toLowerCase()} but the hospital has ${resources[k]}.`).join(" ")} Change what it needs, or add capacity on the Resources page.
          </Notice>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy} className={cx(logged && "!bg-emerald-600 !border-emerald-600")}>
            {logged ? <Check size={16} aria-hidden /> : <Ambulance size={16} aria-hidden />}
            {logged ? "Logged" : "Log ambulance"}
          </Button>
          <Button variant="secondary" onClick={() => void loadExampleAmbulances()}>
            <FlaskConical size={16} aria-hidden /> Load examples
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function InboundBoard() {
  const { patients, current, deletePatient, cancelPatient } = useStore();
  const rows = useMemo(
    () => patients.filter((p) => p.alert_time != null).sort((a, b) => a.arrival_time - b.arrival_time || a.patient_id.localeCompare(b.patient_id)),
    [patients],
  );

  const outcomeFor = (p: PatientRow): { label: string; tone: Tone } => {
    if (p.status === "cancelled") return { label: "Cancelled", tone: "grey" };
    const o = current?.output.patients.find((x) => x.id === p.patient_id);
    if (!o) return { label: "Not simulated yet", tone: "grey" };
    if (o.status !== "treated") return { label: "Not treated", tone: "red" };
    return o.wait_time <= AMBULANCE_GRACE ? { label: o.wait_time === 0 ? "Received on arrival" : `Started after ${o.wait_time} min`, tone: "green" } : { label: `Waited ${o.wait_time} min`, tone: "yellow" };
  };

  return (
    <Card
      title={`Inbound ambulances (${rows.filter((p) => p.status !== "cancelled").length})`}
      description={
        <>
          Every logged ambulance is part of the next simulation.{" "}
          <Link href="/simulation" className="font-medium text-blue-700 underline underline-offset-2">
            Run it on the Simulation page
          </Link>{" "}
          to see who is received on arrival.
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState>No ambulances yet. Log one above or choose “Load examples”.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-600 uppercase">
              <tr>
                {["Arrives", "ID", "Condition", "Urgency", "Warned at", "Travel", "Treatment", "Needs", "Last simulation", ""].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => {
                const outcome = outcomeFor(p);
                const alert = p.alert_time as number;
                return (
                  <tr key={p.id} className={p.status === "cancelled" ? "text-slate-400" : undefined}>
                    <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                      <Ambulance size={13} aria-hidden className="mr-1 inline text-red-600" />
                      {slotLabel(p.arrival_time)} <span className="text-xs text-slate-500">· min {p.arrival_time}</span>
                    </td>
                    <th scope="row" className="px-2 py-2 font-semibold">{p.patient_id}</th>
                    <td className="px-2 py-2">{p.condition}</td>
                    <td className="px-2 py-2">
                      <Badge tone={p.urgency >= 4 ? "red" : p.urgency === 3 ? "yellow" : "grey"}>{p.urgency}</Badge>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap tabular-nums">min {alert}</td>
                    <td className="px-2 py-2 whitespace-nowrap tabular-nums">{p.arrival_time - alert} min</td>
                    <td className="px-2 py-2 tabular-nums">{p.treatment_time} min</td>
                    <td className="px-2 py-2 text-xs">{resourceSummary(p.required_resources)}</td>
                    <td className="px-2 py-2">
                      <Badge tone={outcome.tone}>{outcome.label}</Badge>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        {p.status !== "cancelled" && p.status !== "treated" && (
                          <Button variant="ghost" className="!px-2 !py-1" aria-label={`Cancel ambulance ${p.patient_id}`} title="Cancel (exclude from simulations)" onClick={() => void cancelPatient(p.patient_id)}>
                            <XCircle size={16} aria-hidden />
                          </Button>
                        )}
                        <Button variant="ghost" className="!px-2 !py-1 text-red-700" aria-label={`Delete ambulance ${p.patient_id}`} title="Delete" onClick={() => void deletePatient(p.patient_id)}>
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
