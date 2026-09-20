
export const THEME_STORAGE_KEY = "waitless-theme";
export const THEME_PREFERENCES = ["light", "system", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

export const DARK_QUERY = "(prefers-color-scheme: dark)";

export function normalizePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export const THEME_INIT_SCRIPT = `(function(){var d=false;try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});d=p==="dark"||(p!=="light"&&matchMedia(${JSON.stringify(DARK_QUERY)}).matches)}catch(e){try{d=matchMedia(${JSON.stringify(DARK_QUERY)}).matches}catch(e2){}}document.documentElement.setAttribute("data-theme",d?"dark":"light")})()`;
