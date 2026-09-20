import { expect, test } from "@playwright/test";

/** Patients request medicine and equipment, and the Algorithms tab explains the maths. */

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__cleared")) {
      localStorage.clear();
      sessionStorage.setItem("__cleared", "1");
    }
  });
});

test("a new patient starts with the standard requests for their condition, and they can be edited", async ({ page }) => {
  await page.goto("/inventory");
  await page.getByRole("button", { name: "Load example inventory" }).click();
  await expect(page.getByText(/Loaded 6 medicines and 3 kinds of equipment/)).toBeVisible();

  await page.goto("/patients");
  const needs = page.getByRole("group", { name: /Medicine and equipment needed/ });
  await page.locator("#condition").selectOption("Fracture");
  await expect(needs).toContainText("Standard for fracture");
  await expect(needs).toContainText("Syringes (pcs) ×1");
  await expect(needs).toContainText("Gloves (pairs) ×2");

  // Urgency changes the standard set: a critical cardiac event also needs a defibrillator.
  await page.locator("#condition").selectOption("Cardiac event");
  const requested = (name: string) => needs.getByRole("listitem").filter({ hasText: name });
  await expect(requested("Cardiac monitor")).toHaveCount(1);
  await expect(requested("Defibrillator")).toHaveCount(0);
  await page.locator("#urgency").selectOption("5");
  await expect(needs).toContainText("Defibrillator (equipment) ×1");

  // Editing the list makes it the patient's own; reset goes back to the standard set.
  await page.getByRole("button", { name: "Remove Defibrillator (equipment)" }).click();
  await expect(needs).toContainText("Edited");
  await expect(requested("Defibrillator")).toHaveCount(0);
  await page.getByRole("button", { name: /Reset to standard/ }).click();
  await expect(needs).toContainText("Defibrillator (equipment) ×1");

  await page.locator("#patient_id").fill("REQ1");
  await page.getByRole("button", { name: "Add patient", exact: true }).click();
  const row = page.getByRole("row", { name: /REQ1/ });
  await expect(row).toContainText("Defibrillator ×1");
  await expect(row).toContainText("ECG electrodes ×5");
});

test("without an inventory the patient list says nothing was requested", async ({ page }) => {
  await page.goto("/patients");
  await page.locator("#patient_id").fill("NOINV");
  await page.getByRole("button", { name: "Add patient", exact: true }).click();
  await expect(page.getByRole("row", { name: /NOINV/ })).toContainText("None requested");
});

test("the simulation page has an Algorithms tab that explains every strategy", async ({ page }) => {
  await page.goto("/simulation");
  await page.getByRole("tab", { name: "Algorithms" }).click();
  for (const title of ["First-Come, First-Served", "Urgency Only", "Dynamic Priority", "Harm-Density Index"]) {
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  await expect(page.getByText("S = α·u + β·w + γ·r + δ·e")).toBeVisible();
  await expect(page.getByText(/I\s+= h\(w\) \/ c/)).toBeVisible();

  // The tab is linkable and can be narrowed to one group.
  await page.goto("/simulation#algorithms");
  await expect(page.getByRole("heading", { name: "Dynamic Priority" })).toBeVisible();
  await page.getByRole("radio", { name: "Measures" }).click();
  await expect(page.getByRole("heading", { name: "Dynamic Priority" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Objective score/ })).toBeVisible();
});

test("Run demo books appointments and ambulances, fills stock needs, and names its doctors", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Run demo/ }).click();
  await expect(page.getByText(/Demo scenario loaded and simulated/)).toBeVisible();

  await page.goto("/staff");
  await expect(page.getByRole("row", { name: /Dr\. / }).first()).toBeVisible();
  await expect(page.getByText(/Open position from Resources/)).toHaveCount(0);

  await page.goto("/patients");
  await expect(page.getByRole("row", { name: /^A01 Appt/ })).toContainText("Gloves");
  await expect(page.getByRole("row", { name: /^D07 Amb/ })).toContainText("Gloves");
});
