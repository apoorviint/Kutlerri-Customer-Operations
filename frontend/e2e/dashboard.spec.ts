import { expect, test, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "test-password-123";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
}

const tab = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

test("signing in is required, and a wrong password says so", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("p.problem")).toHaveText(/Invalid email or password/);
});

test("the Overview opens first, with revenue, calls, emails and a row per client", async ({ page }) => {
  await signIn(page);
  await expect(tab(page, "Overview")).toHaveAttribute("aria-pressed", "true");
  for (const heading of ["Revenue", "Calls", "Emails", "By client"]) await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(page.getByText("Active clients")).toBeVisible();
  // the acceptance figures for 17 Aug to 9 Oct
  await page.getByLabel("To", { exact: true }).fill("2026-10-09");
  await expect(page.getByText("$2,840.86").first()).toBeVisible();
  await expect(page.getByText("$568.17").first()).toBeVisible();
  await expect(page.getByText("8 orders · by order date")).toBeVisible();
  await expect(page.getByTestId("billing-last-upload")).toContainText("Billing sheet last uploaded:");
  await expect(page.getByText(/of 6 clients · with calls, orders or emails/)).toBeVisible();
  // only Rasa has email data so far, and the page says so rather than showing six clients of zeros as if it were complete
  await expect(page.getByText(/Email data is available for 1 of 6 clients/)).toBeVisible();
});

test("the date range applies to every tab, and an empty range says so", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("From", { exact: true }).fill("2026-01-01");
  await page.getByLabel("To", { exact: true }).fill("2026-01-02");
  // nothing is ever shown before the start date, so this range is empty
  await expect(page.getByText(/No calls, orders or emails in the selected dates/)).toBeVisible();
  await tab(page, "Representative View").click();
  await expect(page.getByText(/No calls in the selected dates/)).toBeVisible();
});

test("Representative View: the calls table, sorting, opening a row and a Representative's profile", async ({ page }) => {
  await signIn(page);
  await tab(page, "Representative View").click();
  await expect(page.getByRole("heading", { name: "Calls by Sales Representative and Client" })).toBeVisible();
  await expect(page.getByText("Total dials")).toBeVisible();

  // a Representative with two or more clients opens into them
  const opener = page.locator("#view-ops .xpd").first();
  await opener.click();
  await expect(page.locator("#view-ops tr.kid").first()).toBeVisible();

  // Answered opens its dispositions
  await page.getByRole("button", { name: /^Answered/ }).click();
  await expect(page.getByRole("columnheader", { name: "Do Not Call Again" })).toBeVisible();

  // the profile
  await page.locator("#view-ops .who").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Meaningful conversations", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: /Call recordings/ }).click();
  await expect(dialog.locator(".rrow").first()).toBeVisible();
  await expect(dialog.getByRole("link", { name: /Listen/ }).first()).toHaveAttribute("target", "_blank");
  await dialog.getByRole("button", { name: /^Not answered/ }).click();
  await expect(dialog.getByRole("button", { name: /^No Answer/ })).toBeVisible();

  // Escape closes it
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("a profile keeps keyboard focus inside while it is open", async ({ page }) => {
  await signIn(page);
  await tab(page, "Representative View").click();
  await page.locator("#view-ops .who").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest(".sheet"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // and focus goes back to the name that opened it
  expect(await page.evaluate(() => document.activeElement?.classList.contains("who"))).toBe(true);
});

test("Representative View: weekly revenue and the call timing, daily and weekly", async ({ page }) => {
  await signIn(page);
  await tab(page, "Representative View").click();
  await expect(page.getByText(/Weekly run rate/)).toBeVisible();
  const timing = page.locator("#timing");
  await expect(timing.getByText("Call timing and breaks")).toBeVisible();
  await expect(timing.locator(".tm-row").first()).toBeVisible();
  await timing.getByRole("button", { name: "Weekly" }).click();
  await expect(timing.locator(".tw-row").first()).toBeVisible();
  await expect(timing.getByLabel("Choose a representative")).toBeVisible();
});

test("Client View: a client's profile with its emails", async ({ page }) => {
  await signIn(page);
  await tab(page, "Client View").click();
  await expect(page.getByRole("heading", { name: "Calls by Client and Sales Representative" })).toBeVisible();
  await page.locator("#view-client .who", { hasText: "Rasa" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Emails" }).click();
  await expect(dialog.locator(".em-sum")).toContainText("Sent");
  await dialog.getByRole("button", { name: /^Replied/ }).click();
  await dialog.locator(".mhead").first().click();
  // an email's text is shown in a sandboxed frame, or says it is not available yet; either way nothing can run
  await expect(dialog.locator(".mbody")).toBeVisible();
  expect(await dialog.locator("iframe").count() === 0 || (await dialog.locator("iframe").first().getAttribute("sandbox")) === "").toBe(true);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("nothing makes the page scroll sideways", async ({ page }) => {
    await signIn(page);
    for (const name of ["Overview", "Representative View", "Client View"]) {
      await tab(page, name).click();
      await page.waitForTimeout(800);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow, `${name} scrolls sideways`).toBe(false);
    }
  });
});
