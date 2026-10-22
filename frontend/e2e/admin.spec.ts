import { expect, test, type Page } from "@playwright/test";

// Drives the real admin console in Chrome. Everything it uploads is rolled back or deleted again, so the data is left as it was.
const ADMIN = { email: process.env.E2E_EMAIL ?? "admin@example.com", password: process.env.E2E_PASSWORD ?? "test-password-123" };
const VIEWER = { email: "viewer@example.com", password: process.env.E2E_PASSWORD ?? "test-password-123" };

async function signIn(page: Page, who = ADMIN) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
}
async function openAdmin(page: Page, tab: string) {
  await signIn(page);
  await page.getByRole("link", { name: "Admin console" }).click();
  await expect(page.getByRole("heading", { name: "Admin console" })).toBeVisible();
  await page.getByRole("tab", { name: tab, exact: true }).click();
}
const csv = (name: string, body: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(body) });

test.beforeEach(({ page }) => {
  page.on("dialog", (d) => void d.accept()); // the "roll back?" questions
});

test("a viewer cannot see or use the admin console", async ({ page }) => {
  await signIn(page, VIEWER);
  await expect(page.getByRole("link", { name: "Admin console" })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page.getByText("for administrators only")).toBeVisible();
  const r = await page.request.get("/api/admin/data-quality");
  expect(r.status()).toBe(403);
});

test("signed out, the admin API is closed", async ({ request }) => {
  expect((await request.get("/api/admin/mappings")).status()).toBe(401);
  expect((await request.get("/api/admin/files/billing/uploads")).status()).toBe(401);
});

test("data quality shows the feeds and the calls with no client", async ({ page }) => {
  await openAdmin(page, "Data quality");
  await expect(page.getByRole("heading", { name: "Feeds" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Calls", exact: true })).toBeVisible();
  await expect(page.getByText("Calls with no client")).toBeVisible();
  await expect(page.getByText("Agents not mapped to a Representative")).toBeVisible();
});

test("who dialed for whom: check, save, see it in the history, roll it back", async ({ page }) => {
  await openAdmin(page, "Who dialed for whom");
  const file = csv("day.csv", "Date,Representative,Client,Phone number\n2027-03-01,Nia,Rasa,(555) 010-9911\n");
  await page.getByLabel("Who dialed for whom file").setInputFiles(file);
  await page.getByRole("button", { name: "Check the file" }).click();
  await expect(page.getByText("What would change:")).toBeVisible();
  await expect(page.getByText(/1 lines added/)).toBeVisible();
  await page.getByRole("button", { name: "Save this upload" }).click();
  await expect(page.getByText(/Saved\. The calls from 2027-03-01/)).toBeVisible();
  const row = page.locator("tbody tr", { hasText: "day.csv" }).first();
  await expect(row).toContainText("committed");
  await row.getByRole("button", { name: "Roll back" }).click();
  await expect(page.getByText(/rolled back/).first()).toBeVisible();
  await expect(page.locator("tbody tr", { hasText: "day.csv" }).first()).toContainText("rolled back");
});

test("a sheet with an unknown Representative is refused with the reason", async ({ page }) => {
  await openAdmin(page, "Who dialed for whom");
  await page.getByLabel("Who dialed for whom file").setInputFiles(csv("bad.csv", "Date,Representative,Client,Phone number\n2027-03-02,Nobody Here,Rasa,(555) 010-9912\n"));
  await page.getByRole("button", { name: "Check the file" }).click();
  await expect(page.getByText("These must be fixed before saving:")).toBeVisible();
  await expect(page.getByText(/Nobody Here/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save this upload" })).toBeDisabled();
});

test("billing: flags a total that does not add up, saves, and rolls back", async ({ page }) => {
  await openAdmin(page, "Billing");
  const head = "Invoice no,Client,Representative,Created date,Order date,Account,Subtotal,Tax,Tip,Fee,Discount,Total";
  await page.getByLabel("Billing file").setInputFiles(csv("orders.csv", `${head}\nE2E-1,Rasa,Nia,2027-03-01,2027-03-02,Test Co,100,0,0,0,20,100\n`));
  await page.getByRole("button", { name: "Check the file" }).click();
  await expect(page.getByText(/1 order\(s\) where Total ≠ Subtotal/)).toBeVisible();
  await expect(page.getByText(/1 new/)).toBeVisible();
  await page.getByRole("button", { name: "Save this upload" }).click();
  await expect(page.getByText("Saved. The revenue figures are updated.")).toBeVisible();
  await expect(page.getByText(/last upload:/)).not.toContainText("never");
  const row = page.locator("tbody tr", { hasText: "orders.csv" }).first();
  await row.getByRole("button", { name: "Roll back" }).click();
  await expect(page.locator("tbody tr", { hasText: "orders.csv" }).first()).toContainText("rolled back");
});

test("prospect databases: upload, watch it finish, roll it back; replacing needs a second confirmation", async ({ page }) => {
  await openAdmin(page, "Prospect databases");
  await page.getByLabel("Client for this database").selectOption({ label: "Rasa" });
  await page.getByLabel("Prospect database file").setInputFiles(csv("rasa-e2e.csv", "First Name,Last Name,Title,Company,Mobile Phone,HQ Phone\nTest,Person,Chef,Test Co,(555) 010-7711,(555) 010-0000\n"));
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText(/Uploaded\. The file is being read in the background/)).toBeVisible();
  const row = page.locator("tbody tr", { hasText: "rasa-e2e.csv" }).first();
  await expect(row).toContainText("committed", { timeout: 30_000 });
  await expect(row).toContainText("append");
  await row.getByRole("button", { name: "Roll back" }).click();
  await expect(page.locator("tbody tr", { hasText: "rasa-e2e.csv" }).first()).toContainText("rolled back");

  // replacing asks twice and nothing is uploaded until the second click
  await page.getByLabel("Prospect database file").setInputFiles(csv("rasa-replace.csv", "Name,Phone\nA B,5550107722\n"));
  await page.getByLabel(/Replace this client/).check();
  await expect(page.getByText(/Replacing takes out every database currently loaded for/)).toBeVisible();
  await page.getByRole("button", { name: "Upload…" }).click();
  await expect(page.getByRole("button", { name: "Yes, replace and upload" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("tbody tr", { hasText: "rasa-replace.csv" })).toHaveCount(0);
});

test("a file that is not a spreadsheet is refused", async ({ page }) => {
  await openAdmin(page, "Billing");
  await page.getByLabel("Billing file").setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") });
  await page.getByRole("button", { name: "Check the file" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Upload an \.xlsx or \.csv file/ })).toBeVisible();
});

test("mappings: an email rule can be added and deleted, and settings save", async ({ page }) => {
  await openAdmin(page, "Mappings & settings");
  await page.getByText("Email rules: which sender belongs to which client").click();
  await page.getByLabel("Rule value").fill("e2e-test-brand.com");
  await page.getByLabel("Rule client").selectOption({ label: "HotChi" });
  await page.getByRole("button", { name: "Add rule" }).click();
  const row = page.locator("tbody tr", { hasText: "e2e-test-brand.com" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);

  await page.getByText("Schedules, breaks and rules").click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Nothing changed.")).toBeVisible();
});

test("jobs can be re-run for a range, and the audit log shows what was done", async ({ page }) => {
  await openAdmin(page, "Jobs");
  await page.getByLabel("Job to run").selectOption("rebuild-rollups");
  await page.getByLabel("From date").fill("2026-10-08");
  await page.getByLabel("To date").fill("2026-10-09");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByText(/Started\. It runs in the background/)).toBeVisible();
  await page.getByRole("tab", { name: "Audit log" }).click();
  await expect(page.getByRole("cell", { name: "job.run" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "assignments.upload" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "billing.upload" }).first()).toBeVisible();
});

test("the admin console works on a phone-sized screen without sideways scrolling of the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openAdmin(page, "Billing");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
