import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY, normalizePreference, resolveTheme } from "@/lib/theme";

const read = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");

/** Runs the pre-paint script against a fake browser and returns the data-theme it set. */
function runInitScript(opts: { saved?: string | null; systemDark?: boolean; storageThrows?: boolean; matchMediaThrows?: boolean }): string | null {
  let attr: string | null = null;
  const localStorage = {
    getItem: (k: string) => {
      if (opts.storageThrows) throw new Error("blocked");
      return k === THEME_STORAGE_KEY ? (opts.saved ?? null) : null;
    },
  };
  const matchMedia = () => {
    if (opts.matchMediaThrows) throw new Error("unsupported");
    return { matches: opts.systemDark === true };
  };
  const document = { documentElement: { setAttribute: (_: string, v: string) => (attr = v) } };
  new Function("localStorage", "matchMedia", "document", THEME_INIT_SCRIPT)(localStorage, matchMedia, document);
  return attr;
}

describe("theme model", () => {
  it("treats anything but light or dark as system", () => {
    expect(normalizePreference("light")).toBe("light");
    expect(normalizePreference("dark")).toBe("dark");
    for (const bad of [null, undefined, "", "purple", 3, "system"]) expect(normalizePreference(bad)).toBe("system");
  });

  it("resolves system from the operating-system setting and ignores it otherwise", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("pre-paint script (no flash of the wrong theme)", () => {
  it("applies a saved choice before anything renders", () => {
    expect(runInitScript({ saved: "dark", systemDark: false })).toBe("dark");
    expect(runInitScript({ saved: "light", systemDark: true })).toBe("light");
  });

  it("follows the system setting when nothing valid is saved", () => {
    expect(runInitScript({ saved: null, systemDark: true })).toBe("dark");
    expect(runInitScript({ saved: "system", systemDark: false })).toBe("light");
    expect(runInitScript({ saved: "garbage", systemDark: true })).toBe("dark");
  });

  it("survives blocked storage and missing matchMedia", () => {
    expect(runInitScript({ storageThrows: true, systemDark: true })).toBe("dark");
    expect(runInitScript({ storageThrows: true, matchMediaThrows: true })).toBe("light");
  });
});

describe("theme wiring and tokens", () => {
  const css = read("app", "globals.css");
  const darkBlock = css.slice(css.indexOf(':root[data-theme="dark"]'));

  it("dark mode is driven by the data-theme attribute, not only the OS media query", () => {
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).not.toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
  });

  it("every semantic token exists in both themes", () => {
    const light = css.slice(0, css.indexOf(':root[data-theme="dark"]'));
    const tokens = [
      "--background", "--foreground", "--surface", "--card", "--border", "--muted", "--primary", "--success", "--warning", "--danger",
      "--chart-blue", "--chart-green", "--chart-yellow", "--chart-red", "--chart-grey", "--chart-axis", "--chart-grid", "--chart-line", "--chart-cursor",
    ];
    for (const t of tokens) {
      expect(light, `${t} (light)`).toContain(`${t}:`);
      // --card and --primary are aliases resolved on <html>, so the light definition covers both themes.
      if (t !== "--card" && t !== "--primary") expect(darkBlock, `${t} (dark)`).toContain(`${t}:`);
    }
    expect(css).toContain("color-scheme: dark");
    expect(css).toContain("color-scheme: light");
  });

  it("charts use theme variables instead of fixed colours", () => {
    const charts = read("components", "ResultsCharts.tsx");
    expect(charts).not.toMatch(/"#[0-9a-fA-F]{3,8}"/);
    expect(charts).toContain("var(--chart-blue)");
    expect(read("components", "PatientTimeline.tsx")).not.toMatch(/color:\s*"#/);
  });

  it("the root layout sets the attribute early, hydration-safely, and wraps the app in one provider", () => {
    const layout = read("app", "layout.tsx");
    expect(layout).toContain("THEME_INIT_SCRIPT");
    expect(layout).toContain("suppressHydrationWarning");
    expect(layout).toMatch(/<ThemeProvider>[\s\S]*<AppShell>/);
  });

  it("the toggle is in the shell (sidebar and mobile header) and there is exactly one theme state", () => {
    const shell = read("components", "AppShell.tsx");
    expect(shell.match(/<ThemeToggle/g)?.length).toBe(2);
    expect(read("components", "ThemeProvider.tsx")).toContain("useSyncExternalStore");
    // no page keeps its own copy of the theme
    for (const f of ["page.tsx", "patients/page.tsx", "resources/page.tsx", "simulation/page.tsx", "history/page.tsx", "appointments/page.tsx"]) {
      expect(read("app", f), f).not.toMatch(/data-theme|localStorage/);
    }
  });
});
