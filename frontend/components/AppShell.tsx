"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Ambulance, CalendarDays, FlaskConical, History, LayoutDashboard, Pill, Stethoscope, UserCog, Users, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { RunSummaryDialog } from "./RunSummaryDialog";
import { ThemeToggle } from "./ThemeToggle";
import { cx, EcgLine, LoadingBlock, Notice, StatusDot } from "./ui";
import { DATA_NOTICE, DISCLAIMER } from "@/lib/constants";
import { slotLabel } from "@/lib/simulation";
import { StoreProvider, useStore } from "@/lib/store";

const NAV: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/", label: "Control Room", Icon: LayoutDashboard },
  { href: "/patients", label: "Patients", Icon: Users },
  { href: "/appointments", label: "Appointments", Icon: CalendarDays },
  { href: "/ambulances", label: "Ambulances", Icon: Ambulance },
  { href: "/resources", label: "Resources", Icon: Stethoscope },
  { href: "/inventory", label: "Inventory", Icon: Pill },
  { href: "/staff", label: "Staff", Icon: UserCog },
  { href: "/simulation", label: "Simulation", Icon: FlaskConical },
  { href: "/history", label: "History", Icon: History },
];

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
      <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-b from-blue-500 to-blue-600 text-white shadow-sm ring-1 ring-white/20 ring-inset">
        <EcgLine className="h-4 w-5" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-slate-900">Waitless</span>
    </Link>
  );
}

function Status() {
  const { connection, engineMode, patients, ready, current, playing, viewTime } = useStore();
  return (
    <div className="space-y-2.5">
      {current && playing && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700" role="status">
          <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-red-500" />
          Live · {slotLabel(viewTime)}
        </p>
      )}
      <ul className="space-y-1.5" aria-label="System status">
        <li title={connection?.message}>
          <StatusDot tone={!ready ? "grey" : connection?.connected ? "green" : "yellow"}>
            {!ready ? "Checking database…" : connection?.connected ? "Database connected" : "Browser storage"}
          </StatusDot>
        </li>
        <li>
          <StatusDot tone={engineMode === "real" ? "green" : "yellow"}>{engineMode === "real" ? "Engine ready" : "Placeholder engine"}</StatusDot>
        </li>
        <li>
          <StatusDot tone="blue">
            <span className="tabular-nums">{ready ? patients.length : "…"}</span> patients stored
          </StatusDot>
        </li>
      </ul>
    </div>
  );
}

function Toaster() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={cx(
            "pointer-events-auto flex animate-pop items-start justify-between gap-2 rounded-lg border bg-surface px-3.5 py-2.5 text-sm shadow-lg",
            t.kind === "success" && "border-emerald-200 text-emerald-900",
            t.kind === "error" && "border-red-200 text-red-900",
            t.kind === "info" && "border-slate-200 text-slate-800",
          )}
        >
          <span className="flex items-start gap-2">
            <span
              aria-hidden
              className={cx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", t.kind === "success" ? "bg-emerald-500" : t.kind === "error" ? "bg-red-500" : "bg-blue-500")}
            />
            {t.message}
          </span>
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="mt-0.5 shrink-0 text-slate-400 hover:text-slate-700">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function NavLinks({ vertical }: { vertical: boolean }) {
  const pathname = usePathname();
  return (
    <ul className={cx("flex", vertical ? "flex-col gap-0.5" : "gap-1")}>
      {NAV.map(({ href, label, Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600",
                active ? "bg-blue-600/[0.08] text-slate-900" : "text-slate-500 hover:bg-slate-900/[0.05] hover:text-slate-900",
              )}
            >
              <Icon size={16} aria-hidden className={active ? "text-blue-700" : "text-slate-400"} />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { ready, connection } = useStore();
  return (
    <div className="min-h-screen lg:pl-56">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-slate-200 bg-surface px-3 py-4 lg:flex">
        <div className="px-2.5 pb-5">
          <Logo />
        </div>
        <nav aria-label="Main" className="flex-1">
          <NavLinks vertical />
        </nav>
        <div className="space-y-4 border-t border-slate-100 px-2.5 pt-4">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Theme</p>
            <ThemeToggle />
          </div>
          <Status />
        </div>
      </aside>

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-surface/90 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between px-4 py-2.5">
          <Logo />
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Activity size={13} aria-hidden /> {!ready ? "…" : connection?.connected ? "Database" : "Browser storage"}
            </span>
            <ThemeToggle />
          </div>
        </div>
        <nav aria-label="Main" className="overflow-x-auto px-3 pb-2">
          <NavLinks vertical={false} />
        </nav>
      </header>

      <main key={pathname} className="mx-auto w-full max-w-6xl animate-fade px-4 py-6 sm:px-6 lg:py-8">
        {ready && connection && !connection.connected && (
          <Notice tone="yellow" className="mb-5">
            <strong>Database disconnected.</strong> {connection.message}
          </Notice>
        )}
        {ready ? children : <LoadingBlock />}
        <p className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-400">
          {DISCLAIMER} {DATA_NOTICE}
        </p>
      </main>
      <RunSummaryDialog />
      <Toaster />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <Frame>{children}</Frame>
    </StoreProvider>
  );
}
