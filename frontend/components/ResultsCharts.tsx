"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReactNode } from "react";
import { Card, EmptyState } from "./ui";
import {
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  waitHistogram,
  type SimulationOutput,
} from "@/lib/simulation";

export const CHART_COLORS = {
  blue: "#2563eb",
  green: "#16a34a",
  yellow: "#d97706",
  red: "#dc2626",
  grey: "#64748b",
};

const axis = { fontSize: 12, fill: "#475569" };

function ChartCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <div role="img" aria-label={`${title}. ${description}`} className="h-64">
        {children}
      </div>
      <p className="mt-2 text-xs text-slate-500">{description}</p>
    </Card>
  );
}

export function ResultsCharts({ output }: { output: SimulationOutput | null }) {
  if (!output) return <EmptyState>No simulation results available.</EmptyState>;

  const { timeline, params } = output;
  const events: ReactNode[] = [];
  if (params.emergencySurge && params.surgeStart <= timeline.length - 1) {
    events.push(<ReferenceLine key="surge" x={params.surgeStart} stroke={CHART_COLORS.yellow} strokeDasharray="4 3" label={{ value: "Surge", fill: CHART_COLORS.yellow, fontSize: 11, position: "insideTopRight" }} />);
  }
  if (params.resourceFailure && params.failureStart <= timeline.length - 1) {
    events.push(<ReferenceLine key="fail" x={params.failureStart} stroke={CHART_COLORS.red} strokeDasharray="4 3" label={{ value: "Failure", fill: CHART_COLORS.red, fontSize: 11, position: "insideTopLeft" }} />);
  }

  const status = timeline.map((p) => ({ t: p.t, Treated: p.treated, "In treatment": p.in_treatment, Waiting: p.queue_length }));
  const utilization = RESOURCE_KEYS.map((k) => ({
    name: RESOURCE_LABELS[k],
    Utilization: Math.round(output.metrics.resource_utilization[k] * 100),
  }));
  const histogram = waitHistogram(output.patients, 10);
  const placeholder = output.isPlaceholder ? " (placeholder data)" : "";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title={`Queue length over time${placeholder}`} description="Patients that have arrived and are waiting for treatment at each minute.">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={timeline} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="t" tick={axis} label={{ value: "minute", position: "insideBottomRight", offset: -2, fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={axis} />
            <Tooltip labelFormatter={(t) => `Minute ${t}`} />
            <Area type="stepAfter" dataKey="queue_length" name="Waiting" stroke={CHART_COLORS.blue} fill={CHART_COLORS.blue} fillOpacity={0.2} isAnimationActive={false} />
            {events}
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={`Resource utilization${placeholder}`} description="Share of nominal capacity-minutes used over the whole run. Red ≥ 90%, yellow ≥ 70%.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={utilization} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ ...axis, fontSize: 11 }} />
            <YAxis domain={[0, 100]} unit="%" tick={axis} />
            <Tooltip formatter={(v) => `${v}%`} />
            <ReferenceLine y={90} stroke={CHART_COLORS.red} strokeDasharray="4 3" />
            <Bar dataKey="Utilization" isAnimationActive={false} fill={CHART_COLORS.blue} shape={(props: { x?: number; y?: number; width?: number; height?: number; payload?: { Utilization: number } }) => {
              const v = props.payload?.Utilization ?? 0;
              const fill = v >= 90 ? CHART_COLORS.red : v >= 70 ? CHART_COLORS.yellow : CHART_COLORS.green;
              return <rect x={props.x} y={props.y} width={props.width} height={props.height} fill={fill} rx={2} />;
            }} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={`Patient waiting-time distribution${placeholder}`} description="Number of arrived patients by waiting time (minutes). Patients not yet started are counted with their wait so far.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={histogram} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="range" tick={{ ...axis, fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={axis} />
            <Tooltip />
            <Bar dataKey="count" name="Patients" fill={CHART_COLORS.blue} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={`Treated versus waiting patients${placeholder}`} description="Cumulative treated patients, patients in treatment and patients waiting at each minute.">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={status} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="t" tick={axis} />
            <YAxis allowDecimals={false} tick={axis} />
            <Tooltip labelFormatter={(t) => `Minute ${t}`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area type="stepAfter" stackId="s" dataKey="Treated" stroke={CHART_COLORS.green} fill={CHART_COLORS.green} fillOpacity={0.5} isAnimationActive={false} />
            <Area type="stepAfter" stackId="s" dataKey="In treatment" stroke={CHART_COLORS.yellow} fill={CHART_COLORS.yellow} fillOpacity={0.5} isAnimationActive={false} />
            <Area type="stepAfter" stackId="s" dataKey="Waiting" stroke={CHART_COLORS.red} fill={CHART_COLORS.red} fillOpacity={0.4} isAnimationActive={false} />
            {events}
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
