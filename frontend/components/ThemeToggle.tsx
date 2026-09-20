"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { Segmented } from "./ui";
import { useTheme } from "./ThemeProvider";
import type { ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <Segmented
      label="Colour theme"
      size="sm"
      className={className}
      value={preference}
      onChange={setPreference}
      options={OPTIONS.map(({ value, label, Icon }) => ({
        value,
        title: value === "system" ? `System (currently ${resolved})` : label,
        label: (
          <span className="flex items-center gap-1">
            <Icon size={13} aria-hidden />
            <span className="sr-only">{label}</span>
          </span>
        ),
      }))}
    />
  );
}
