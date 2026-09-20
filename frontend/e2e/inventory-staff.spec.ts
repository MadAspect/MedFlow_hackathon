import { expect, test, type Page } from "@playwright/test";

/** Inventory, staff availability and live patient arrivals, in a real browser. */

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__cleared")) {
      localStorage.clear();
      sessionStorage.setItem("__cleared", "1");
    }
  });
});

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function runDemo(page: Page) {
  page.on("dialog", (d) => void d.accept());
  await page.goto("/");
  await page.getByRole("button", { name: /^Run demo/ }).click();
  await expect(page.getByText(/patients stored/).first()).toContainText("30");
  await page.goto("/simulation");
}

test("inventory: load stock, edit a quantity, and the status follows the numbers", async ({ page }) => {
  await page.goto("/inventory");
  await expect(page.getByText("No stock yet.")).toBeVisible();
  await expect(page.getByText(/Stock constraints are off/)).toBeVisible();

  await page.getByRole("button", { name: "Load example inventory" }).click();
  await expect(page.getByText(/Loaded 6 medicines and 3 kinds of equipment/)).toBeVisible();
  const iv = page.getByRole("row", { name: /IV sets/ });
  await expect(iv).toContainText("In stock");

  // 300 IV sets with a minimum of 110: drop to 100 -> low, drop to 0 -> out of stock.
  const qty = page.getByLabel("Quantity of IV sets");
  await qty.fill("100");
  await qty.press("Enter");
  await expect(iv).toContainText("Low stock");
  await qty.fill("0");
  await qty.press("Enter");
  await expect(iv).toContainText("Out of stock");
  await expect(page.getByRole("list", { name: "Stock warnings" })).toContainText("IV sets is out of stock.");

  // A negative quantity is refused with an explanation and nothing changes.
  await qty.fill("-5");
  await qty.press("Enter");
  await expect(page.getByText(/must be a whole number of 0 or more/)).toBeVisible();
  await expect(iv).toContainText("Out of stock");

  // Search and status filter.
  await page.getByLabel("Search stock").fill("glove");
  await expect(page.getByRole("row", { name: /Gloves/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /IV sets/ })).toHaveCount(0);
  await page.getByLabel("Search stock").fill("");
  await page.getByLabel("Filter by status").selectOption("out_of_stock");
  await expect(page.getByRole("row", { name: /IV sets/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Gloves/ })).toHaveCount(0);
});

test("inventory: add a medicine and equipment, mark equipment under maintenance and back", async ({ page }) => {
  await page.goto("/inventory");
  await page.locator("#med_name").fill("Insulin");
  await page.locator("#med_category").fill("Endocrine");
  await page.locator("#med_quantity").fill("8");
  await page.locator("#med_min").fill("10");
  await page.locator("#med_unit").fill("vials");
  await page.getByRole("button", { name: "Add medicine" }).click();
  await expect(page.getByText("Insulin added to the medicine stock.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Insulin/ })).toContainText("Low stock"); // 8 <= 10

  await page.locator("#eq_name").fill("Infusion pump");
  await page.locator("#eq_category").fill("Infusion");
  await page.locator("#eq_quantity").fill("3");
  await page.getByRole("button", { name: "Add equipment" }).click();
  await page.getByRole("tab", { name: /Equipment/ }).click();
  const pump = page.getByRole("row", { name: /Infusion pump/ });
  await expect(pump).toContainText("Available");

  await pump.getByRole("button", { name: /Mark maintenance/ }).click();
  await expect(pump).toContainText("Unavailable");
  await expect(pump).toContainText("Maintenance");
  await pump.getByRole("button", { name: /Mark available/ }).click();
  await expect(pump).toContainText("Available");

  // Available units can never exceed what is owned.
  const avail = page.getByLabel("Available units of Infusion pump");
  await avail.fill("9");
  await avail.press("Enter");
  await expect(page.getByText(/more than the 3 owned/)).toBeVisible();
});

test("staff: change availability, filter by role, and the history records it", async ({ page }) => {
  await page.goto("/staff");
  await expect(page.getByRole("heading", { name: "Faculty and Medical Staff", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load example staff" }).click();
  await expect(page.getByText(/Loaded 17 example staff members/)).toBeVisible();

  await page.getByLabel("Reason for the next change").fill("called to surgery");
  await page.getByLabel("Availability for Dr. Arjun Rao").selectOption("unavailable");
  const row = page.getByRole("row", { name: /Dr\. Arjun Rao/ });
  await expect(row).toContainText("Unavailable");
  await expect(row.getByRole("button", { name: "Mark available" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Availability history" })).toContainText("Dr. Arjun Rao");
  await expect(page.getByRole("list", { name: "Availability history" })).toContainText("called to surgery");

  await row.getByRole("button", { name: "Mark available" }).click();
  await expect(row).toContainText("Available");

  await page.getByLabel("Filter by role").selectOption("technician");
  await expect(page.getByRole("row", { name: /Vikram Joshi/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Dr\. Arjun Rao/ })).toHaveCount(0);

  // Add and edit a person.
  await page.getByLabel("Filter by role").selectOption("");
  await page.locator("#st_name").fill("Nurse Test");
  await page.locator("#st_role").selectOption("nurse");
  await page.locator("#st_department").fill("Ward");
  await page.getByRole("button", { name: "Add staff" }).click();
  await expect(page.getByText("Nurse Test added to the staff list.")).toBeVisible();
  await page.getByRole("button", { name: "Edit Nurse Test" }).click();
  await page.locator("#st_department").fill("ICU");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("row", { name: /Nurse Test/ })).toContainText("ICU");
});

test("control room shows staff, stock and equipment once they exist", async ({ page }) => {
  await page.goto("/inventory");
  await page.getByRole("button", { name: "Load example inventory" }).click();
  await page.goto("/staff");
  await page.getByRole("button", { name: "Load example staff" }).click();
  await page.getByLabel("Availability for Dr. Meera Iyer").selectOption("on_leave");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Staff availability" })).toBeVisible();
  await expect(page.getByText(/16 of 17 available/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Staff not available" })).toContainText("Dr. Meera Iyer");
  await expect(page.getByRole("list", { name: "Equipment availability" })).toContainText("Ventilator");
  await expect(page.getByText("All stock above its minimum.")).toBeVisible();
});

test("a patient added to a run in progress arrives now, joins the queue and is counted", async ({ page }) => {
  await runDemo(page);
  await expect(page.getByText(/40 of 40 patients were treated/)).toBeVisible();

  const slider = page.getByRole("slider", { name: "Simulation minute" });
  await slider.focus();
  await slider.press("Home");
  for (let i = 0; i < 20; i++) await slider.press("ArrowRight");
  await expect(page.getByText(/Arrives now, at minute 20/)).toBeVisible();

  await page.getByRole("button", { name: "Add patient to current run" }).click();
  await expect(page.getByText(/L\d{3} arrived at minute 20 and joined the queue; treatment starts at minute \d+/)).toBeVisible();

  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByText(/41 of 41 patients were treated/)).toBeVisible();

  // Stored once, and the run was saved to history.
  await page.goto("/patients");
  await expect(page.getByRole("row", { name: /^L\d{3} / })).toHaveCount(1);
  await page.goto("/history");
  await expect(page.getByRole("row")).not.toHaveCount(0);
});

test("marking a doctor unavailable mid-run recalculates the run from that minute", async ({ page }) => {
  await runDemo(page);
  await page.goto("/staff");
  await page.getByRole("button", { name: "Load example staff" }).click();
  await page.getByLabel("Availability for Dr. Arjun Rao").selectOption("unavailable");
  await expect(page.getByText(/Dr\. Arjun Rao is (now unavailable|marked unavailable)/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Availability history" })).toContainText("from minute");
});

test("a finished simulation opens a summary popup with resources and faculty, and it can be reopened", async ({ page }) => {
  await runDemo(page);
  const replay = page.getByRole("switch", { name: "Live replay" });
  if ((await replay.getAttribute("aria-checked")) === "true") await replay.click();
  await page.getByRole("button", { name: "Run simulation" }).click();

  const dialog = page.getByRole("dialog", { name: "Simulation complete" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Faculty working" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Resources used" })).toBeVisible();
  await expect(dialog).toContainText("on the Resources page");
  await expect(dialog).toContainText("Patients treated");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Run summary" }).click();
  await expect(dialog).toBeVisible();
});

test("with live replay the summary popup waits until the replay reaches the end", async ({ page }) => {
  await runDemo(page);
  await page.getByRole("radio", { name: "60×" }).click();
  await page.getByRole("button", { name: "Run simulation" }).click();

  const dialog = page.getByRole("dialog", { name: "Simulation complete" });
  await expect(page.getByRole("button", { name: "Pause replay" })).toBeVisible(); // still playing
  await expect(dialog).toBeHidden();
  await expect(dialog).toBeVisible({ timeout: 30_000 });
});

test("the staff list follows the doctors and nurses set on the Resources page", async ({ page }) => {
  await page.goto("/resources");
  await page.locator("#cap-doctor").fill("3");
  await page.locator("#cap-nurse").fill("4");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Resource configuration saved.")).toBeVisible();

  // Nobody is named yet: exactly the configured positions show up.
  await page.goto("/staff");
  await expect(page.getByText("3 doctors", { exact: true })).toBeVisible();
  await expect(page.getByText("4 nurses", { exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /^Doctor 3 / })).toBeVisible();
  await expect(page.getByRole("row", { name: /^Doctor 4 / })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /^Nurse 4 / })).toBeVisible();

  // The example roster has 5 doctors and 10 nurses: the ones beyond the configured number are not scheduled.
  await page.getByRole("button", { name: "Load example staff" }).click();
  await expect(page.getByRole("row", { name: /Dr\. Kabir Shah/ })).not.toContainText("not scheduled");
  await expect(page.getByRole("row", { name: /Dr\. Omar Siddiqui/ })).toContainText("not scheduled");
  await expect(page.getByRole("row", { name: /Tara George/ })).toContainText("not scheduled");

  // The Control Room card agrees: 3 doctors + 4 nurses + 2 technicians.
  await page.goto("/");
  await expect(page.getByText(/9 available/)).toBeVisible();
});

test("inventory and staff pages fit the screen with no sideways page scroll", async ({ page }) => {
  await page.goto("/inventory");
  await page.getByRole("button", { name: "Load example inventory" }).click();
  await expect(page.getByRole("row", { name: /IV sets/ })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  await page.goto("/staff");
  await page.getByRole("button", { name: "Load example staff" }).click();
  await expect(page.getByRole("row", { name: /Dr\. Arjun Rao/ })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});
