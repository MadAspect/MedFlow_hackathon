"use client";

import { Check, FlaskConical, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { Button, Card, Field, inputClass, cx } from "./ui";
import { CONDITIONS } from "@/lib/constants";
import { useStore } from "@/lib/store";
import { RESOURCE_KEYS, RESOURCE_LABELS, type ResourceKey } from "@/lib/simulation";
import { parseNumberField, validatePatient, type FieldErrors } from "@/lib/validation";

const URGENCY_LABELS = ["1 – Low", "2 – Minor", "3 – Moderate", "4 – High", "5 – Critical"];

function nextId(ids: string[]): string {
  let n = ids.length + 1;
  const taken = new Set(ids.map((i) => i.toLowerCase()));
  while (taken.has(`p${String(n).padStart(3, "0")}`)) n++;
  return `P${String(n).padStart(3, "0")}`;
}

export function PatientForm() {
  const { patients, addPatient, loadExample, clearPatients } = useStore();
  const [patientId, setPatientId] = useState("");
  const [arrival, setArrival] = useState("0");
  const [urgency, setUrgency] = useState("3");
  const [treatment, setTreatment] = useState("20");
  const [condition, setCondition] = useState<string>(CONDITIONS[0]);
  const [needs, setNeeds] = useState<Partial<Record<ResourceKey, number>>>({ doctor: 1 });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = (key: ResourceKey, on: boolean) =>
    setNeeds((prev) => {
      const next = { ...prev };
      if (on) next[key] = next[key] || 1;
      else delete next[key];
      return next;
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = validatePatient(
      {
        patient_id: patientId,
        condition,
        arrival_time: parseNumberField(arrival),
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
    setErrors({});
    setBusy(true);
    const ok = await addPatient(result.data);
    setBusy(false);
    if (ok) {
      setAdded(true);
      window.setTimeout(() => setAdded(false), 1800);
      setPatientId(nextId([...patients.map((p) => p.patient_id), result.data.patient_id]));
    }
  }

  const err = (k: string) => errors[k];
  const a11y = (k: string) => ({ "aria-invalid": err(k) ? true : undefined, "aria-describedby": err(k) ? `${k}-error` : undefined });

  return (
    <Card
      title="Add patient"
      description="Synthetic data only. Times are minutes from the start of the simulation."
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Patient ID" htmlFor="patient_id" error={err("patient_id")} hint="Letters, numbers, - and _">
            <input id="patient_id" className={inputClass} value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder={nextId(patients.map((p) => p.patient_id))} maxLength={32} {...a11y("patient_id")} />
          </Field>
          <Field label="Condition" htmlFor="condition" error={err("condition")}>
            <select id="condition" className={inputClass} value={condition} onChange={(e) => setCondition(e.target.value)} {...a11y("condition")}>
              {CONDITIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Urgency" htmlFor="urgency" error={err("urgency")}>
            <select id="urgency" className={inputClass} value={urgency} onChange={(e) => setUrgency(e.target.value)} {...a11y("urgency")}>
              {URGENCY_LABELS.map((label, i) => (
                <option key={label} value={i + 1}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Arrival time (min)" htmlFor="arrival_time" error={err("arrival_time")}>
            <input id="arrival_time" type="number" inputMode="numeric" className={inputClass} value={arrival} onChange={(e) => setArrival(e.target.value)} {...a11y("arrival_time")} />
          </Field>
          <Field label="Treatment time (min)" htmlFor="treatment_time" error={err("treatment_time")}>
            <input id="treatment_time" type="number" inputMode="numeric" className={inputClass} value={treatment} onChange={(e) => setTreatment(e.target.value)} {...a11y("treatment_time")} />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-800">Required resources</legend>
          <div className="flex flex-wrap gap-2">
            {RESOURCE_KEYS.map((key) => {
              const on = needs[key] !== undefined;
              return (
                <div key={key} className={cx("flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm", on ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-white")}>
                  <input id={`res-${key}`} type="checkbox" checked={on} onChange={(e) => toggle(key, e.target.checked)} className="h-4 w-4 accent-blue-700" />
                  <label htmlFor={`res-${key}`}>{RESOURCE_LABELS[key]}</label>
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

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy} className={cx(added && "!bg-emerald-700 !border-emerald-700")}>
            {added ? <Check size={16} aria-hidden /> : <UserPlus size={16} aria-hidden />}
            {added ? "Added" : "Add Patient"}
          </Button>
          <Button variant="secondary" onClick={() => void loadExample()}>
            <FlaskConical size={16} aria-hidden /> Load Example Data
          </Button>
          <Button
            variant="danger"
            disabled={patients.length === 0}
            onClick={() => {
              if (window.confirm(`Delete all ${patients.length} patients?`)) void clearPatients();
            }}
          >
            <Trash2 size={16} aria-hidden /> Clear All Patients
          </Button>
        </div>
      </form>
    </Card>
  );
}
