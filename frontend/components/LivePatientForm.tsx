"use client";

import { UserPlus } from "lucide-react";
import { useState } from "react";
import { StockNeeds, useStockDraft } from "./StockNeeds";
import { Button, Card, Field, inputClass, cx } from "./ui";
import { CONDITIONS } from "@/lib/constants";
import { useStore } from "@/lib/store";
import { RESOURCE_KEYS, RESOURCE_LABELS, slotLabel, type ResourceKey } from "@/lib/simulation";

const URGENCY_LABELS = ["1 – Low", "2 – Minor", "3 – Moderate", "4 – High", "5 – Critical"];

/** Adds a patient who walks in at the minute being watched, then recalculates the run from there. */
export function LivePatientForm() {
  const { current, viewTime, addPatientToRun, running } = useStore();
  const [condition, setCondition] = useState<string>(CONDITIONS[0]);
  const [urgency, setUrgency] = useState("3");
  const [treatment, setTreatment] = useState("20");
  const [needs, setNeeds] = useState<Partial<Record<ResourceKey, number>>>({ doctor: 1, bed: 1 });
  const stock = useStockDraft(condition, Number(urgency));
  const [busy, setBusy] = useState(false);

  const output = current?.output ?? null;
  if (!output || output.isPlaceholder) return null;
  const minute = Math.round(Math.min(viewTime, Math.max(0, output.timeline.length - 1)));

  const toggle = (key: ResourceKey, on: boolean) =>
    setNeeds((prev) => {
      const next = { ...prev };
      if (on) next[key] = next[key] || 1;
      else delete next[key];
      return next;
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await addPatientToRun(
      {
        condition,
        urgency: Number(urgency),
        treatment_time: Number(treatment),
        required_resources: needs,
      },
      stock.value,
    );
    setBusy(false);
    if (ok) stock.reset();
  }

  return (
    <Card
      title="Add patient to current run"
      description={`Arrives now, at minute ${minute} (${slotLabel(minute)}). The run is recalculated from its start with this patient in the queue; treatments that already began do not change.`}
    >
      <form onSubmit={submit} noValidate className="space-y-4" aria-label="Add patient to current run">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Condition" htmlFor="live_condition">
            <select id="live_condition" className={inputClass} value={condition} onChange={(e) => setCondition(e.target.value)}>
              {CONDITIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Urgency" htmlFor="live_urgency">
            <select id="live_urgency" className={inputClass} value={urgency} onChange={(e) => setUrgency(e.target.value)}>
              {URGENCY_LABELS.map((label, i) => (
                <option key={label} value={i + 1}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Treatment time (min)" htmlFor="live_treatment">
            <input id="live_treatment" type="number" inputMode="numeric" className={inputClass} value={treatment} onChange={(e) => setTreatment(e.target.value)} />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-800">Required resources</legend>
          <div className="flex flex-wrap gap-2">
            {RESOURCE_KEYS.map((key) => {
              const on = needs[key] !== undefined;
              return (
                <div key={key} className={cx("flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm", on ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-surface")}>
                  <input id={`live-res-${key}`} type="checkbox" checked={on} onChange={(e) => toggle(key, e.target.checked)} className="h-4 w-4 accent-blue-700" />
                  <label htmlFor={`live-res-${key}`}>{RESOURCE_LABELS[key]}</label>
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
        </fieldset>

        <StockNeeds draft={stock} />

        <Button type="submit" disabled={busy || running}>
          <UserPlus size={16} aria-hidden /> {busy ? "Adding…" : "Add patient to current run"}
        </Button>
      </form>
    </Card>
  );
}
