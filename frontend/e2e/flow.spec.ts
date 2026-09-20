import { expect, test, type Page } from "@playwright/test";

/** Demo start-to-finish in a real browser: arrivals → priority → allocation → simulation → statistics. */

async function runDemo(page: Page) {
  page.on("dialog", (d) => void d.accept());
  await page.goto("/");
  await page.getByRole("button", { name: /^Run demo/ }).click();
  await expect(page.getByText(/patients stored/).first()).toContainText("30"); // demo patients and appointments were written
  await page.goto("/simulation");
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__cleared")) {
      localStorage.clear();
      sessionStorage.setItem("__cleared", "1");
    }
  });
});

test("without Supabase the app says it is using browser storage, never 'connected'", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Database disconnected.")).toBeVisible();
  await expect(page.getByText(/^Database connected$/)).toHaveCount(0);
  await expect(page.getByText(/Browser storage/).first()).toBeAttached();
});

for (const mode of ["Light", "Dark"] as const) {
  test(`demo runs to completion and the comparison table renders in ${mode} mode`, async ({ page }) => {
    await runDemo(page);
    await page.getByRole("radio", { name: mode, exact: true }).click();

    // Performance statistics come from the run, and the run continued past the planned duration.
    await expect(page.getByText(/40 of 40 patients were treated/)).toBeVisible();
    await expect(page.getByText(/simulation continued until minute/)).toBeVisible();

    await page.getByRole("tab", { name: /Compare/ }).click();
    const table = page.getByRole("table").filter({ hasText: "Past safety limit" });
    await expect(table).toBeVisible();
    for (const label of ["First-Come, First-Served", "Urgency Only", "Dynamic Priority", "Harm-Density Index"]) {
      await expect(table.getByRole("rowheader", { name: new RegExp(label) })).toBeVisible();
    }

    // Readable text: the table text colour must differ from the page background.
    const [fg, bg] = await page.evaluate(() => {
      const td = [...document.querySelectorAll("table")].find((t) => t.textContent?.includes("Past safety limit"))!.querySelector("td")!;
      return [getComputedStyle(td).color, getComputedStyle(document.body).backgroundColor];
    });
    expect(fg).not.toBe(bg);
    // No horizontal page scroll on any viewport.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });
}

test("ambulances: log one through the form, load the examples, and see the arrival time worked out", async ({ page }) => {
  await page.goto("/ambulances");
  await expect(page.getByText("No ambulances yet.")).toBeVisible();

  // Dispatch at minute 20 plus a 12-minute journey: the ambulance reaches the hospital at minute 32.
  await expect(page.getByText("reaches the hospital at minute 32")).toBeVisible();
  await page.getByRole("button", { name: "Log ambulance" }).click();
  await expect(page.getByText("Ambulance M001 logged.")).toBeVisible();
  const row = page.getByRole("row", { name: /M001/ });
  await expect(row).toContainText("min 20"); // warned at
  await expect(row).toContainText("12 min"); // travel time

  // A bad journey time is explained next to the field, and nothing is saved.
  await page.getByLabel("Travel time / ETA (min)").fill("0");
  await page.getByRole("button", { name: "Log ambulance" }).click();
  await expect(page.getByText("Travel time must be at least 1 minute.")).toBeVisible();

  await page.getByRole("button", { name: /Load examples/ }).click();
  // M001 is already logged (and is also the first example), so the examples add M002-M005: five in all.
  await expect(page.getByRole("heading", { name: /Inbound ambulances \(5\)/ })).toBeVisible();
});

test("the demo has ambulances: the hospital view shows an inbound lane and the results count them", async ({ page }) => {
  await runDemo(page);
  await expect(page.getByRole("switch", { name: "Act on ambulance pre-alerts" })).toBeChecked();
  await page.getByRole("tab", { name: /Hospital/ }).click();
  await expect(page.getByRole("heading", { name: "Inbound ambulances" })).toBeVisible();

  // At the start of the run the first ambulance (D07, warned at minute 0, arriving at 8) is on its way.
  const slider = page.getByRole("slider").first();
  await slider.focus();
  await slider.press("Home");
  await expect(page.getByRole("list", { name: "Ambulances on their way" })).toContainText("D07");
  await expect(page.getByRole("list", { name: "Ambulances on their way" })).toContainText("arrives in 8 min");

  await page.getByRole("tab", { name: /Compare/ }).click();
  await expect(page.getByText(/ambulance patients started within 10 min/).first()).toBeVisible();
});

test("hospital view keeps updating as the clock moves through the whole run", async ({ page }) => {
  await runDemo(page);
  await page.getByRole("tab", { name: /Hospital/ }).click();
  const slider = page.getByRole("slider").first();
  await expect(slider).toBeVisible();
  const before = await page.evaluate(() => document.querySelector("main")!.innerText);
  await slider.focus();
  await slider.press("End");
  await expect.poll(() => page.evaluate(() => document.querySelector("main")!.innerText)).not.toBe(before);
});
