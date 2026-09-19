"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, cx, EcgLine, LoadingBlock, Notice } from "./ui";
import { DATA_NOTICE, DISCLAIMER } from "@/lib/constants";
import { StoreProvider, useStore } from "@/lib/store";

const NAV = [
  { href: "/", label: "Control Room" },
  { href: "/patients", label: "Patients" },
  { href: "/resources", label: "Resources" },
  { href: "/simulation", label: "Simulation" },
  { href: "/history", label: "History" },
];

function StatusBar() {
  const { connection, engineMode, current, patients, ready } = useStore();
  const lastRun = current?.createdAt ? new Date(current.createdAt).toLocaleString() : "None yet";
  const dbTone = !ready ? "grey" : connection?.connected ? "green" : "yellow";
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700" aria-label="System status">
      <li className="flex items-center gap-1.5" title={connection?.message}>
        Database:
        <Badge tone={dbTone}>{!ready ? "Checking…" : connection?.connected ? "Connected" : "Disconnected"}</Badge>
        {ready && !connection?.connected && <span className="text-slate-500">(browser storage)</span>}
      </li>
      <li className="flex items-center gap-1.5">
        Simulation engine:
        <Badge tone={engineMode === "real" ? "green" : "yellow"}>{engineMode === "real" ? "Ready" : "Placeholder"}</Badge>
      </li>
      <li>
        Last simulation: <span className="font-medium">{lastRun}</span>
      </li>
      <li>
        Patients stored: <span className="font-medium tabular-nums">{ready ? patients.length : "…"}</span>
      </li>
    </ul>
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
            "pointer-events-auto flex animate-pop items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm shadow-md",
            t.kind === "success" && "border-emerald-300 bg-emerald-50 text-emerald-900",
            t.kind === "error" && "border-red-300 bg-red-50 text-red-900",
            t.kind === "info" && "border-blue-200 bg-blue-50 text-blue-900",
          )}
        >
          <span>{t.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="mt-0.5 shrink-0 opacity-60 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { ready, connection } = useStore();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="glass sticky top-0 z-40 border-b border-slate-200/80 shadow-sm shadow-slate-900/5">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-sky-400 text-white shadow-md shadow-blue-600/30"
            >
              <EcgLine className="h-5 w-7" />
            </span>
            <div>
              <p className="bg-gradient-to-r from-blue-800 to-sky-600 bg-clip-text text-xl font-extrabold tracking-wide text-transparent">MEDFLOW</p>
              <p className="text-xs text-slate-600">Hospital Resource Management Simulator</p>
            </div>
          </div>
          <StatusBar />
        </div>
        <nav aria-label="Main" className="mx-auto max-w-7xl overflow-x-auto px-4 pb-2">
          <ul className="flex gap-1">
            {NAV.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "block rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                      active ? "bg-blue-700 text-white shadow-sm shadow-blue-900/25" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main key={pathname} className="mx-auto w-full max-w-7xl flex-1 animate-fade px-4 py-6">
        {ready && connection && !connection.connected && (
          <Notice tone="yellow" className="mb-4">
            <strong>Database disconnected.</strong> {connection.message}
          </Notice>
        )}
        {ready ? children : <LoadingBlock />}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <p className="mx-auto max-w-7xl px-4 py-3 text-xs text-slate-600">
          {DISCLAIMER} {DATA_NOTICE}
        </p>
      </footer>
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
