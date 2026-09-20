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
import { useMemo, type ReactNode } from "react";
import { Card, EmptyState, InfoTip } from "./ui";
import {
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  liveSnapshot,
  liveWaitHistogram,
  slotLabel,
  type SimulationOutput,
} from "@/lib/simulation";

export const CHART_COLORS = {
  blue: "var(--chart-blue)",
  green: "var(--chart-green)",
  yellow: "var(--chart-yellow)",
  red: "var(--chart-red)",
  grey: "var(--chart-grey)",
};

const axis = { fontSize: 12, fill: "var(--chart-axis)" };
const grid = { stroke: "var(--chart-grid)", vertical: false } as const;
const tooltipStyle = { borderRadius: 8, border: "1px solid var(--chart-line)", background: "var(--surface)", color: "var(--foreground)", boxShadow: "var(--chart-tooltip-shadow)", fontSize: 12 };

function ChartCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card title={title} actions={<InfoTip align="right">{description}</InfoTip>}>
      <div role="img" aria-label={`${title}. ${description}`} className="h-60">
        {children}
      </div>
    </Card>
  );
}

export function ResultsCharts({ output, viewTime }: { output: SimulationOutput | null; viewTime?: number }) {
  const lastMinute = output ? Math.max(0, output.timeline.length - 1) : 0;
  const t = viewTime === undefined ? lastMinute : Math.max(0, Math.min(lastMinute, Math.round(viewTime)));

  const shown = useMemo(() => (output ? output.timeline.slice(0, t + 1) : []), [output, t]);
  const status = useMemo(
    () => shown.map((p) => ({ t: p.t, Treated: p.treated, "In treatment": p.in_treatment, Waiting: p.queue_length })),
    [shown],
  );
  const snap = useMemo(() => (output ? liveSnapshot(output, t) : null), [output, t]);
  const histogram = useMemo(() => (output ? liveWaitHistogram(output, t, 10) : []), [output, t]);

  if (!output || !snap) return <EmptyState>Run a simulation to see charts.</EmptyState>;

  const { params } = output;
  const events: ReactNode[] = [];
  if (params.emergencySurge && params.surgeStart <= t) {
    events.push(<ReferenceLine key="surge" x={params.surgeStart} stroke={CHART_COLORS.yellow} strokeDasharray="4 3" label={{ value: "Surge", fill: "var(--chart-warn-text)", fontSize: 11, position: "insideTopRight" }} />);
  }
  if (params.resourceFailure && params.failureStart <= t) {
    events.push(<ReferenceLine key="fail" x={params.failureStart} stroke={CHART_COLORS.red} strokeDasharray="4 3" label={{ value: "Failure", fill: "var(--chart-crit-text)", fontSize: 11, position: "insideTopLeft" }} />);
  }

  const utilization = RESOURCE_KEYS.map((k) => ({
    name: RESOURCE_LABELS[k],
    Utilization: Math.round(snap.utilization[k] * 100),
  }));
  const placeholder = output.isPlaceholder ? " (placeholder data)" : "";
  const xAxis = (
    <XAxis
      dataKey="t"
      type="number"
      domain={[0, lastMinute]}
      allowDecimals={false}
      tick={axis}
      tickLine={false}
      axisLine={{ stroke: "var(--chart-line)" }}
      tickFormatter={(m: number) => slotLabel(m)}
      minTickGap={28}
    />
  );
  const yAxis = <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} width={32} />;
  const minuteLabel = (m: unknown) => `${slotLabel(Number(m))} · minute ${m}`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title={`Patients waiting${placeholder}`} description="Patients that have arrived and are waiting for treatment, minute by minute.">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={shown} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...grid} />
            {xAxis}
            {yAxis}
            <Tooltip labelFormatter={minuteLabel} contentStyle={tooltipStyle} />
            <Area type="stepAfter" dataKey="queue_length" name="Waiting" stroke={CHART_COLORS.blue} strokeWidth={2} fill={CHART_COLORS.blue} fillOpacity={0.12} isAnimationActive={false} />
            {events}
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={`Resource utilization${placeholder}`} description="Share of each resource's capacity-minutes used from the start up to now. Red is 90% or more, amber 70% or more.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={utilization} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...grid} />
            <XAxis dataKey="name" tick={{ ...axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--chart-line)" }} />
            <YAxis domain={[0, 100]} unit="%" tick={axis} tickLine={false} axisLine={false} width={40} />
            <Tooltip formatter={(v) => `${v}%`} contentStyle={tooltipStyle} cursor={{ fill: "var(--chart-cursor)" }} />
            <ReferenceLine y={90} stroke={CHART_COLORS.red} strokeDasharray="4 3" />
            <Bar
              dataKey="Utilization"
              isAnimationActive={false}
              fill={CHART_COLORS.blue}
              shape={(props: { x?: number; y?: number; width?: number; height?: number; payload?: { Utilization: number } }) => {
                const v = props.payload?.Utilization ?? 0;
                const fill = v >= 90 ? CHART_COLORS.red : v >= 70 ? CHART_COLORS.yellow : CHART_COLORS.green;
                return <rect x={props.x} y={props.y} width={props.width} height={props.height} fill={fill} rx={4} />;
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={`Waiting-time distribution${placeholder}`} description="How many arrived patients have waited each number of minutes so far. Patients who have not started yet count with their wait so far.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={histogram} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...grid} />
            <XAxis dataKey="range" tick={{ ...axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--chart-line)" }} />
            {yAxis}
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--chart-cursor)" }} />
            <Bar dataKey="count" name="Patients" fill={CHART_COLORS.blue} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={`Treated, in treatment, waiting${placeholder}`} description="Cumulative treated patients, patients in treatment and patients waiting at each minute.">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={status} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...grid} />
            {xAxis}
            {yAxis}
            <Tooltip labelFormatter={minuteLabel} contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
            <Area type="stepAfter" stackId="s" dataKey="Treated" stroke={CHART_COLORS.green} fill={CHART_COLORS.green} fillOpacity={0.45} isAnimationActive={false} />
            <Area type="stepAfter" stackId="s" dataKey="In treatment" stroke={CHART_COLORS.yellow} fill={CHART_COLORS.yellow} fillOpacity={0.45} isAnimationActive={false} />
            <Area type="stepAfter" stackId="s" dataKey="Waiting" stroke={CHART_COLORS.red} fill={CHART_COLORS.red} fillOpacity={0.35} isAnimationActive={false} />
            {events}
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
