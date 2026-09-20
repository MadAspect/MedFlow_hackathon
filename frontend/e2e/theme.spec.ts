import { expect, test, type Page } from "@playwright/test";

const ROUTES = ["/", "/patients", "/appointments", "/resources", "/simulation", "/history"];
const KEY = "waitless-theme";

// Values of the design tokens in app/globals.css.
const BG = { light: "rgb(246, 247, 249)", dark: "rgb(11, 15, 23)" };

const theme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const token = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const choose = (page: Page, name: "Light" | "System" | "Dark") => page.getByRole("radio", { name, exact: true }).click();

test.beforeEach(async ({ page }) => {
  // Start every test from a clean browser: no saved preference, light system setting.
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__cleared")) {
      localStorage.clear();
      sessionStorage.setItem("__cleared", "1");
    }
  });
});

for (const route of ROUTES) {
  for (const mode of ["light", "dark"] as const) {
    test(`${mode} theme applies to ${route}`, async ({ page }) => {
      await page.goto(route);
      await choose(page, mode === "light" ? "Light" : "Dark");
      expect(await theme(page)).toBe(mode);
      expect(await bodyBg(page)).toBe(BG[mode]);
      // Native controls (date pickers, selects) follow the theme through color-scheme.
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(mode);
      // The sidebar / header surface must come from the active theme's card token.
      const chrome = await page.evaluate(() => {
        const el = document.querySelector("aside:not([hidden])") as HTMLElement | null;
        const visible = el && getComputedStyle(el).display !== "none" ? el : document.querySelector("header");
        return getComputedStyle(visible as Element).borderBottomColor + "|" + getComputedStyle(visible as Element).borderRightColor;
      });
      expect(chrome).toBeTruthy();
      expect(await token(page, "--chart-grid")).toBe(mode === "light" ? "#eef2f7" : "#1b2433");
      // No horizontal scrolling (responsive layout intact in both themes).
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
}

test("choice persists across refresh and navigation", async ({ page }) => {
  await page.goto("/");
  await choose(page, "Dark");
  await page.reload({ waitUntil: "domcontentloaded" });
  // The inline script sets the attribute while parsing, before React hydrates: no flash of light.
  expect(await theme(page)).toBe("dark");
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("dark");

  await page.goto("/resources");
  expect(await theme(page)).toBe("dark");
  expect(await bodyBg(page)).toBe(BG.dark);
  await page.getByRole("link", { name: "History" }).first().click();
  await page.waitForURL("**/history");
  expect(await theme(page)).toBe("dark");
});

test("System follows the operating-system setting live", async ({ page }) => {
  await page.goto("/");
  await choose(page, "System");
  expect(await theme(page)).toBe("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => theme(page)).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => theme(page)).toBe("light");
});

test("an explicit choice overrides the operating-system setting", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await choose(page, "Light");
  expect(await theme(page)).toBe("light");
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await theme(page)).toBe("light");
});

test("a corrupted saved value falls back to the system setting", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript((k) => localStorage.setItem(k, "purple"), KEY);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(await theme(page)).toBe("dark");
});

test("charts and status colours switch with the theme", async ({ page }) => {
  const names = ["--chart-axis", "--chart-line", "--chart-blue", "--chart-red", "--success", "--warning", "--danger"];
  await page.goto("/");
  await choose(page, "Light");
  const light = await Promise.all(names.map((n) => token(page, n)));
  await choose(page, "Dark");
  const dark = await Promise.all(names.map((n) => token(page, n)));
  for (const v of [...light, ...dark]) expect(v).not.toBe("");
  // Every chart / status token has a different value in the other theme, so nothing is left hardcoded.
  expect(names.filter((_, i) => light[i] === dark[i])).toEqual([]);
});
