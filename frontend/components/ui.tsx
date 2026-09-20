"use client";

import { Info } from "lucide-react";
import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

export type Tone = "blue" | "green" | "yellow" | "red" | "grey";

export const toneClasses: Record<Tone, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  yellow: "bg-amber-50 text-amber-800 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
  grey: "bg-slate-100 text-slate-600 border-slate-200",
};

export const barClasses: Record<Tone, string> = {
  blue: "bg-blue-600",
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
  grey: "bg-slate-400",
};

export const dotClasses: Record<Tone, string> = {
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
  grey: "bg-slate-400",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
}) {
  const styles = {
    primary: "border-blue-600 bg-blue-600 text-white shadow-sm hover:bg-[#1d4ed8] hover:border-[#1d4ed8] active:bg-[#1e40af]",
    secondary: "border-slate-200 bg-surface text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-300",
    danger: "border-slate-200 bg-surface text-red-700 shadow-sm hover:bg-red-50 hover:border-red-200",
    ghost: "border-transparent bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  }[variant];
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border font-medium whitespace-nowrap transition-colors",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
        "disabled:cursor-not-allowed disabled:opacity-50",
        styles,
        className,
      )}
    />
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("min-w-0 rounded-xl border border-slate-200 bg-surface shadow-[0_1px_2px_rgb(15_23_42/0.04)]", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={cx("p-5", Boolean(title || actions) && "pt-3.5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Badge({ tone = "grey", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs leading-none font-medium whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
      <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", dotClasses[tone])} />
      {children}
    </span>
  );
}

export function Notice({ tone = "blue", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <div role={tone === "red" ? "alert" : "status"} className={cx("rounded-lg border px-3.5 py-2.5 text-sm", toneClasses[tone], className)}>
      {children}
    </div>
  );
}

export const inputClass =
  "h-9 w-full rounded-lg border border-slate-200 bg-surface px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 " +
  "hover:border-slate-300 focus-visible:border-blue-500 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-blue-500/30 " +
  "aria-[invalid=true]:border-red-500 disabled:bg-slate-100";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p id={`${htmlFor}-error`} className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function NumberInput({
  id,
  value,
  onValue,
  min,
  max,
  step,
  invalid,
  disabled,
  className,
}: {
  id: string;
  value: number;
  onValue: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  // Keep what the user typed while it still matches `value` (so "1." or an empty
  // field survive re-renders); otherwise show the value set from outside.
  const [text, setText] = useState<string | null>(null);
  const matches =
    text !== null && (text.trim() === "" ? Number.isNaN(value) : Number(text) === value);
  const shown = matches ? text : Number.isNaN(value) ? "" : String(value);
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      className={cx(inputClass, className)}
      value={shown}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      onChange={(e) => {
        setText(e.target.value);
        onValue(e.target.value.trim() === "" ? NaN : Number(e.target.value));
      }}
    />
  );
}

export function ProgressBar({ value, tone, label }: { value: number; tone: Tone; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
    >
      <div className={cx("h-full rounded-full transition-[width] duration-300 ease-out", barClasses[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

export function LoadingBlock() {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-1/3 rounded-lg bg-slate-200" />
      <div className="h-32 rounded-xl bg-slate-200" />
      <div className="h-32 rounded-xl bg-slate-200" />
    </div>
  );
}

export function EcgLine({ className, animated = true }: { className?: string; animated?: boolean }) {
  return (
    <svg viewBox="0 0 160 40" fill="none" aria-hidden className={className} preserveAspectRatio="none">
      <path
        d="M0 22 H34 L40 22 L46 8 L54 34 L60 22 H92 L98 22 L104 12 L110 30 L114 22 H160"
        pathLength={1}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className={animated ? "ecg-line" : undefined}
      />
    </svg>
  );
}

export function InfoTip({ children, label = "More info", align = "center" }: { children: ReactNode; label?: string; align?: "left" | "center" | "right" }) {
  const id = useId();
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="rounded-full text-slate-400 transition-colors hover:text-slate-700 focus-visible:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
      >
        <Info size={14} aria-hidden />
      </button>
      <span
        id={id}
        role="tooltip"
        className={cx(
          "pointer-events-none invisible absolute top-full z-40 mt-2 w-64 rounded-lg bg-slate-900 px-3 py-2 text-left text-xs leading-relaxed font-normal whitespace-normal text-slate-100 opacity-0 shadow-xl transition-opacity",
          "group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100",
          align === "center" && "left-1/2 -translate-x-1/2",
          align === "left" && "left-0",
          align === "right" && "right-0",
        )}
      >
        {children}
      </span>
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  ariaLabel,
  info,
  infoAlign = "center",
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  ariaLabel?: string;
  info?: ReactNode;
  infoAlign?: "left" | "center" | "right";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <span className={cx("inline-flex items-center gap-2 text-sm text-slate-700", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-blue-600" : "bg-slate-300",
        )}
      >
        <span className={cx("absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", checked && "translate-x-4")} />
        <span className="sr-only">{ariaLabel ?? (typeof label === "string" ? label : "Toggle")}</span>
      </button>
      <span className="font-medium">{label}</span>
      {info && <InfoTip align={infoAlign}>{info}</InfoTip>}
    </span>
  );
}

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
  size = "md",
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("inline-flex rounded-lg bg-slate-100 p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cx(
              "rounded-md font-medium whitespace-nowrap transition-all",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600",
              active ? "bg-surface-strong text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: { value: T; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={`tab-${t.value}`}
            aria-selected={active}
            aria-controls={`panel-${t.value}`}
            onClick={() => onChange(t.value)}
            className={cx(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600",
              active ? "border-blue-600 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] leading-none text-slate-600 tabular-nums">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("min-w-0 rounded-xl border border-slate-200 bg-surface p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]", className)}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {icon}
        {label}
      </p>
      <p className={cx("mt-1.5 truncate text-2xl leading-none font-semibold tracking-tight tabular-nums", tone === "red" ? "text-red-700" : tone === "yellow" ? "text-amber-700" : tone === "green" ? "text-emerald-700" : "text-slate-900")}>
        {value}
      </p>
      {sub && <p className="mt-1.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export const fmt1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : "–");
export const pct0 = (fraction: number) => `${Math.round(fraction * 100)}%`;
