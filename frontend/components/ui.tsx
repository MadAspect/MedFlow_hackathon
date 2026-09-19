"use client";

import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

export type Tone = "blue" | "green" | "yellow" | "red" | "grey";

export const toneClasses: Record<Tone, string> = {
  blue: "bg-blue-50 text-blue-800 border-blue-200",
  green: "bg-emerald-50 text-emerald-800 border-emerald-200",
  yellow: "bg-amber-50 text-amber-900 border-amber-300",
  red: "bg-red-50 text-red-800 border-red-300",
  grey: "bg-slate-100 text-slate-700 border-slate-300",
};

export const barClasses: Record<Tone, string> = {
  blue: "bg-blue-600",
  green: "bg-emerald-600",
  yellow: "bg-amber-500",
  red: "bg-red-600",
  grey: "bg-slate-400",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const styles = {
    primary:
      "bg-gradient-to-b from-blue-600 to-blue-700 text-white shadow-sm shadow-blue-900/25 hover:from-blue-600 hover:to-blue-800 border-blue-700 active:translate-y-px",
    secondary: "bg-white text-slate-800 hover:bg-slate-50 border-slate-300",
    danger: "bg-white text-red-700 hover:bg-red-50 border-red-300",
    ghost: "bg-transparent text-slate-700 hover:bg-slate-100 border-transparent",
  }[variant];
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium transition-colors",
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
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("min-w-0 rounded-xl border border-slate-200/80 bg-white/90 shadow-sm shadow-slate-900/5 backdrop-blur-sm", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Badge({ tone = "grey", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Notice({ tone = "blue", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <div role={tone === "red" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2 text-sm", toneClasses[tone], className)}>
      {children}
    </div>
  );
}

export const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 aria-[invalid=true]:border-red-500 disabled:bg-slate-100";

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
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-800">
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

/** Number input that lets the user clear the field while typing. */
export function NumberInput({
  id,
  value,
  onValue,
  min,
  max,
  step,
  invalid,
  disabled,
}: {
  id: string;
  value: number;
  onValue: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  invalid?: boolean;
  disabled?: boolean;
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
      className={inputClass}
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
      className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
    >
      <div className={cx("h-full rounded-full transition-[width] duration-500 ease-out", barClasses[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <span aria-hidden className="mb-2 block h-1 w-10 rounded-full bg-gradient-to-r from-blue-600 to-sky-400" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
      {children}
    </div>
  );
}

export function LoadingBlock() {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-1/3 rounded bg-slate-200" />
      <div className="h-32 rounded bg-slate-200" />
      <div className="h-32 rounded bg-slate-200" />
    </div>
  );
}

/** Decorative heartbeat trace. `animated` redraws it forever; it is hidden from assistive tech. */
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

export const fmt1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : "–");
export const pct0 = (fraction: number) => `${Math.round(fraction * 100)}%`;
