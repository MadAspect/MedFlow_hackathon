import { AMBULANCE_GRACE } from "./ambulance";
import { compareStrategies, type Comparison } from "./compare";
import { runAllStrategies, runSimulation } from "./engine";
import { improvementPercent, recommendResource, type ResourceRecommendation } from "./efficiency";
import { treatmentOrder } from "./metrics";
import { STRATEGIES, STRATEGY_LABELS } from "./policies";
import { RESOURCE_LABELS, RESOURCE_SINGULAR } from "./resources";
import {
  RESOURCE_KEYS,
  type Metrics,
  type ResourceSet,
  type SimParams,
  type SimPatient,
  type SimulationOutput,
  type Strategy,
} from "./types";

interface Criterion {
  key: string;
  title: string;
  phrase: string;
  unit: "patients" | "min";
  value: (m: Metrics) => number;
}

export const DECISION_CRITERIA: readonly Criterion[] = [
  {
    key: "remaining",
    title: "Every patient gets treated",
    phrase: "the fewest untreated patients",
    unit: "patients",
    value: (m) => m.patients_remaining,
  },
  {
    key: "breaches",
    title: "Fewest patients waiting past the safety limit",
    phrase: "the fewest patients waiting past the safety limit",
    unit: "patients",
    value: (m) => m.safety_threshold_breaches,
  },
  {
    key: "critical",
    title: "Shortest wait for critical patients",
    phrase: "the shortest average wait for critical patients",
    unit: "min",
    value: (m) => m.critical_wait,
  },
  {
    key: "max",
    title: "Shortest longest wait (fairness)",
    phrase: "the shortest longest wait",
    unit: "min",
    value: (m) => m.maximum_wait,
  },
  {
    key: "avg",
    title: "Shortest average wait",
    phrase: "the shortest average wait",
    unit: "min",
    value: (m) => m.average_wait,
  },
];

export const TIE_MIN_MINUTES = 1;
export const TIE_FRACTION = 0.05;

const TIE_ORDER: Strategy[] = ["fcfs", "dynamic", "urgency"];

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const show = (c: Criterion, v: number) => (c.unit === "min" ? `${f1(v)} min` : String(v));

function isTied(c: Criterion, value: number, best: number): boolean {
  if (c.unit === "patients") return value === best;
  return value - best < Math.max(TIE_MIN_MINUTES, TIE_FRACTION * best);
}

function groupWaits(out: SimulationOutput) {
  const arrived = out.patients.filter((p) => p.status !== "not_arrived");
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    critical: mean(arrived.filter((p) => p.urgency >= out.params.criticalUrgency).map((p) => p.wait_time)),
    regular: mean(arrived.filter((p) => p.urgency < out.params.criticalUrgency).map((p) => p.wait_time)),
  };
}

export interface StrategyVerdict {
  strategy: Strategy;
  tie: boolean;
  headline: string;
  details: string[];
}

export function recommendStrategy(outputs: Record<Strategy, SimulationOutput>): StrategyVerdict {
  let candidates = [...STRATEGIES];
  let decisive: Criterion | null = null;
  for (const c of DECISION_CRITERIA) {
    const values = candidates.map((s) => c.value(outputs[s].metrics));
    const best = Math.min(...values);
    const kept = candidates.filter((_, i) => isTied(c, values[i], best));
    if (kept.length < candidates.length && decisive === null) decisive = c;
    candidates = kept;
  }
  const strategy = TIE_ORDER.find((s) => candidates.includes(s)) ?? "fcfs";
  const label = STRATEGY_LABELS[strategy];
  const fcfsLabel = STRATEGY_LABELS.fcfs;

  if (decisive === null) {
    return {
      strategy,
      tie: true,
      headline: `${fcfsLabel} is enough here: the three strategies perform almost the same.`,
      details: [
        "Reordering the queue only helps when patients compete for the same resource at the same time. The bigger lever in this scenario is capacity — see the advice below.",
      ],
    };
  }

  const mine = decisive.value(outputs[strategy].metrics);
  const base = decisive.value(outputs.fcfs.metrics);
  const headline =
    strategy === "fcfs"
      ? `${label} is recommended: it gives ${decisive.phrase} (${show(decisive, mine)}).`
      : `${label} is recommended: it gives ${decisive.phrase} (${show(decisive, mine)} vs ${show(decisive, base)} under ${fcfsLabel}).`;

  const details: string[] = [];
  if (strategy !== "fcfs") {
    const mineWaits = groupWaits(outputs[strategy]);
    const baseWaits = groupWaits(outputs.fcfs);
    const critical = baseWaits.critical - mineWaits.critical;
    const regular = mineWaits.regular - baseWaits.regular;
    const parts: string[] = [];
    if (Math.abs(critical) >= 0.05) {
      parts.push(`critical patients wait ${f1(Math.abs(critical))} min ${critical > 0 ? "less" : "more"} on average`);
    }
    if (Math.abs(regular) >= 0.05) {
      parts.push(`other patients wait ${f1(Math.abs(regular))} min ${regular > 0 ? "more" : "less"}`);
    }
    if (parts.length > 0) {
      details.push(`Trade-off compared with ${fcfsLabel}: ${parts.join(" and ")}.`);
    }
  }
  return { strategy, tie: false, headline, details };
}

export interface UrgencyWaitRow {
  urgency: number;
  patients: number;
  average: Record<Strategy, number>;
}

export function waitByUrgency(outputs: Record<Strategy, SimulationOutput>): UrgencyWaitRow[] {
  const levels = new Set<number>();
  for (const s of STRATEGIES) {
    for (const p of outputs[s].patients) if (p.status !== "not_arrived") levels.add(p.urgency);
  }
  const avg = (s: Strategy, urgency: number) => {
    const waits = outputs[s].patients
      .filter((p) => p.status !== "not_arrived" && p.urgency === urgency)
      .map((p) => p.wait_time);
    return waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0;
  };
  return [...levels]
    .sort((a, b) => b - a)
    .map((urgency) => ({
      urgency,
      patients: outputs.fcfs.patients.filter((p) => p.status !== "not_arrived" && p.urgency === urgency).length,
      average: {
        fcfs: avg("fcfs", urgency),
        urgency: avg("urgency", urgency),
        dynamic: avg("dynamic", urgency),
        hazard: avg("hazard", urgency),
      },
    }));
}

export type AdviceTone = "red" | "yellow" | "green" | "blue";

export interface AdviceItem {
  id: string;
  tone: AdviceTone;
  title: string;
  detail: string;
}

const SEVERITY: Record<AdviceTone, number> = { red: 0, yellow: 1, green: 2, blue: 3 };

const lower = (s: string) => s.toLowerCase();
const pct0 = (fraction: number) => `${Math.round(fraction * 100)}%`;

function change(label: string, saved: number): string | null {
  if (saved > 0.05) return `${label} falls by ${f1(saved)} min`;
  if (saved < -0.05) return `${label} rises by ${f1(Math.abs(saved))} min`;
  return null;
}

export function buildAdvice(
  outputs: Record<Strategy, SimulationOutput>,
  verdict: StrategyVerdict,
  recommendation: ResourceRecommendation,
  appointmentAlt: SimulationOutput | null = null,
  ambulanceAlt: SimulationOutput | null = null,
): AdviceItem[] {
  const chosen = outputs[verdict.strategy];
  const m = chosen.metrics;
  const params = chosen.params;
  const resources: ResourceSet = chosen.resources;
  const stratLabel = STRATEGY_LABELS[verdict.strategy];
  const top = m.bottlenecks[0];
  const items: AdviceItem[] = [];

  if (!chosen.completed) {
    items.push({
      id: "incomplete",
      tone: "red",
      title: "Some patients could not be treated",
      detail: chosen.error ?? "Not every patient was treated in this run.",
    });
  }

  const best = recommendation.best;
  if (best) {
    const b = recommendation.baseline.metrics;
    const pct = improvementPercent(b.total_waiting_time, best.output.metrics.total_waiting_time, "lower");
    const clauses = [
      change("total waiting", best.totalWaitSaved),
      change("critical-patient waiting", best.criticalWaitSaved),
      best.completionSaved > 0 ? `the last patient finishes ${best.completionSaved} min sooner` : null,
    ].filter((c): c is string => c !== null);
    const bottleneckNote =
      top && top.resource === best.resource
        ? ` ${RESOURCE_LABELS[top.resource]} were the binding shortage for ${top.blocked_patient_minutes} patient-minutes of waiting.`
        : "";
    items.push({
      id: "add-resource",
      tone: "green",
      title: `Add 1 ${RESOURCE_SINGULAR[best.resource]}`,
      detail: `Re-running ${stratLabel} with one more ${RESOURCE_SINGULAR[best.resource]}: ${clauses.join(", ")}${
        Number.isFinite(pct) && Math.abs(pct) >= 0.5 ? ` (${f1(pct)}% ${pct >= 0 ? "less" : "more"} total waiting)` : ""
      }.${bottleneckNote} This is the best of five one-unit additions that were tested.`,
    });
  } else if (m.total_waiting_time > 0) {
    items.push({
      id: "no-single-unit",
      tone: "blue",
      title: "No single extra unit fixes the waiting",
      detail: `Adding one doctor, nurse, bed, ICU bed or operating room did not reduce waiting under ${stratLabel}. The delay may come from patients arriving in bursts or needing several resources at once — try adding more than one unit on the Resources page.`,
    });
  }

  if (top) {
    const idle = RESOURCE_KEYS.filter((k) => k !== top.resource && resources[k] >= 2 && m.resource_utilization[k] < 0.3).sort(
      (a, b) => m.resource_utilization[a] - m.resource_utilization[b],
    )[0];
    if (idle) {
      items.push({
        id: "idle-capacity",
        tone: "blue",
        title: `${RESOURCE_LABELS[idle]} are mostly idle`,
        detail: `Only ${pct0(m.resource_utilization[idle])} in use, while ${lower(RESOURCE_LABELS[top.resource])} are the bottleneck. If capacity is flexible, shifting some from ${lower(RESOURCE_LABELS[idle])} to ${lower(RESOURCE_LABELS[top.resource])} could cut waiting without extra cost.`,
      });
    }
  }

  if (m.safety_threshold_breaches > 0) {
    items.push({
      id: "safety-breaches",
      tone: "yellow",
      title: `${m.safety_threshold_breaches} patient${m.safety_threshold_breaches === 1 ? "" : "s"} waited longer than the ${params.safetyThreshold}-minute safety limit`,
      detail: `Adding capacity at the bottleneck is the most direct fix.${
        verdict.strategy === "dynamic"
          ? " Raising β (the waiting weight) in the advanced settings also makes long-waiting patients climb the queue sooner."
          : ""
      }`,
    });
  }

  const hot = RESOURCE_KEYS.filter((k) => resources[k] > 0 && m.resource_utilization[k] >= 0.9);
  if (hot.length > 0) {
    items.push({
      id: "near-capacity",
      tone: "yellow",
      title: `${hot.map((k) => RESOURCE_LABELS[k]).join(" and ")} ${hot.length === 1 ? "is" : "are"} almost fully used`,
      detail: `At 90% or more there is no slack left for an emergency (${hot.map((k) => `${lower(RESOURCE_LABELS[k])} ${pct0(m.resource_utilization[k])}`).join(", ")}). Extra capacity here also makes the system more resilient to a surge or failure.`,
    });
  }

  if (appointmentAlt && (m.appointments_total ?? 0) > 0) {
    const protectedRun = params.protectAppointments !== false ? chosen : appointmentAlt;
    const plainRun = params.protectAppointments !== false ? appointmentAlt : chosen;
    const a = protectedRun.metrics;
    const b = plainRun.metrics;
    const total = a.appointments_total ?? 0;
    const gained = (a.appointments_on_time ?? 0) - (b.appointments_on_time ?? 0);
    const walkInCost = (a.walk_in_average_wait ?? 0) - (b.walk_in_average_wait ?? 0);
    const facts = `Holding slots: ${a.appointments_on_time ?? 0} of ${total} appointments on time (average delay ${f1(a.appointment_average_delay ?? 0)} min); without: ${b.appointments_on_time ?? 0} of ${total} (${f1(b.appointment_average_delay ?? 0)} min). Walk-ins wait ${f1(a.walk_in_average_wait ?? 0)} min on average with it and ${f1(b.walk_in_average_wait ?? 0)} min without.`;
    if (gained > 0) {
      items.push({
        id: "appointments",
        tone: "green",
        title: `Holding booked slots keeps ${gained} more appointment${gained === 1 ? "" : "s"} on time`,
        detail: `${facts} ${
          walkInCost > 0.05 ? `The price is ${f1(walkInCost)} min more waiting for the average walk-in.` : "Walk-ins did not pay for it."
        } Re-run with the option off to see it yourself.`,
      });
    } else if (gained < 0) {
      items.push({
        id: "appointments",
        tone: "yellow",
        title: "Holding booked slots did not help here",
        detail: `${facts} Idle capacity before a slot cost more than it saved, so switching the option off gives better punctuality on this scenario.`,
      });
    } else if ((b.appointments_total ?? 0) > (b.appointments_on_time ?? 0)) {
      items.push({
        id: "appointments",
        tone: "yellow",
        title: `${total - (a.appointments_on_time ?? 0)} appointment${total - (a.appointments_on_time ?? 0) === 1 ? " is" : "s are"} late whatever the setting`,
        detail: `${facts} The delay comes from treatments that were already running, urgent patients, or too much booked at once, not from walk-ins starting too early. Move the bookings apart on the Appointments page or add capacity.`,
      });
    } else {
      items.push({
        id: "appointments",
        tone: "blue",
        title: "Every appointment started on time",
        detail: `${facts} Slot protection made no difference on this scenario.`,
      });
    }
  }

  if (ambulanceAlt && (m.ambulance_total ?? 0) > 0) {
    const withAlert = params.preAlert !== false ? chosen : ambulanceAlt;
    const without = params.preAlert !== false ? ambulanceAlt : chosen;
    const a = withAlert.metrics;
    const b = without.metrics;
    const total = a.ambulance_total ?? 0;
    const gained = (a.ambulance_on_arrival ?? 0) - (b.ambulance_on_arrival ?? 0);
    const waitSaved = (b.ambulance_average_wait ?? 0) - (a.ambulance_average_wait ?? 0);
    const walkInCost = (a.walk_in_average_wait ?? 0) - (b.walk_in_average_wait ?? 0);
    const facts = `With pre-alerts: ${a.ambulance_on_arrival ?? 0} of ${total} ambulance patients started within ${AMBULANCE_GRACE} min of reaching the hospital (average wait ${f1(a.ambulance_average_wait ?? 0)} min); without: ${b.ambulance_on_arrival ?? 0} of ${total} (${f1(b.ambulance_average_wait ?? 0)} min). Walk-ins wait ${f1(a.walk_in_average_wait ?? 0)} min on average with it and ${f1(b.walk_in_average_wait ?? 0)} min without.`;
    if (gained > 0 || waitSaved > 0.05) {
      items.push({
        id: "ambulances",
        tone: "green",
        title: `Acting on ambulance pre-alerts saves ${f1(waitSaved)} min of average wait for inbound patients`,
        detail: `${facts} ${
          walkInCost > 0.05 ? `The price is ${f1(walkInCost)} min more waiting for the average walk-in, from resources held free while the ambulance is on its way.` : "Walk-ins did not pay for it."
        } Re-run with the option off to see it yourself.`,
      });
    } else if (gained < 0 || waitSaved < -0.05) {
      items.push({
        id: "ambulances",
        tone: "yellow",
        title: "Holding resources for ambulances did not help here",
        detail: `${facts} Capacity held for the journey cost more than it saved on this scenario.`,
      });
    } else if ((a.ambulance_max_wait ?? 0) > AMBULANCE_GRACE) {
      items.push({
        id: "ambulances",
        tone: "yellow",
        title: "Ambulance patients still waited, with or without pre-alerts",
        detail: `${facts} The delay comes from treatments already running or from a resource the hospital does not have enough of, so warning earlier cannot fix it. Add capacity at the bottleneck.`,
      });
    } else {
      items.push({
        id: "ambulances",
        tone: "blue",
        title: "Every ambulance patient was received on arrival",
        detail: `${facts} Pre-alerts made no difference on this scenario.`,
      });
    }
  }

  const order = (s: Strategy) => treatmentOrder(outputs[s]).join("|");
  if (order("dynamic") === order("urgency") && order("dynamic") !== order("fcfs")) {
    items.push({
      id: "dynamic-equals-urgency",
      tone: "blue",
      title: "Dynamic Priority behaved exactly like Urgency Only",
      detail:
        "Waiting time never outweighed a difference in urgency. Raise β (the waiting weight) in the advanced settings, or load the contrast scenario, to see the two diverge.",
    });
  }

  if (items.every((i) => i.tone !== "red" && i.tone !== "yellow") && chosen.completed && m.safety_threshold_breaches === 0) {
    items.push({
      id: "copes",
      tone: "green",
      title: "The system copes with this load",
      detail: `No patient waited past the ${params.safetyThreshold}-minute safety limit and everyone was treated by minute ${m.actual_completion_time}.${
        params.emergencySurge || params.resourceFailure
          ? ""
          : " Switch on an emergency surge or a resource failure to find where it breaks."
      }`,
    });
  }

  return items.sort((a, b) => SEVERITY[a.tone] - SEVERITY[b.tone]);
}

export interface Analysis {
  outputs: Record<Strategy, SimulationOutput>;
  comparison: Comparison;
  verdict: StrategyVerdict;
  recommendation: ResourceRecommendation;
  advice: AdviceItem[];
  urgencyWaits: UrgencyWaitRow[];
}

export function analyse(
  patients: SimPatient[],
  resources: ResourceSet,
  params: Partial<SimParams> = {},
): Analysis {
  const outputs = runAllStrategies(patients, resources, params);
  const verdict = recommendStrategy(outputs);
  const recommendation = recommendResource(patients, resources, params, verdict.strategy);
  const appointmentAlt = patients.some((p) => p.appointment)
    ? runSimulation(patients, resources, {
        ...params,
        strategy: verdict.strategy,
        protectAppointments: params.protectAppointments === false,
      })
    : null;
  const ambulanceAlt = patients.some((p) => p.ambulance)
    ? runSimulation(patients, resources, {
        ...params,
        strategy: verdict.strategy,
        preAlert: params.preAlert === false,
      })
    : null;
  return {
    outputs,
    comparison: compareStrategies(outputs),
    verdict,
    recommendation,
    advice: buildAdvice(outputs, verdict, recommendation, appointmentAlt, ambulanceAlt),
    urgencyWaits: waitByUrgency(outputs),
  };
}
