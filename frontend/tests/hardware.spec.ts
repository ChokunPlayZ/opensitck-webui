import { test, expect } from "@playwright/test";

const username = process.env.WEBUI_USERNAME || "user";
const password = process.env.WEBUI_PASSWORD;

test("MF800H battery/display, confirmed controls, sleep timer and mobile layout", async ({
  page,
}) => {
  if (!password)
    throw new Error("Set WEBUI_PASSWORD to the Debian account password");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const unauthenticated = await page.request.get("/api/hardware");
  expect(unauthenticated.status()).toBe(401);
  await page.goto("/#hardware");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Open console", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Battery & display", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Single-click macro", { exact: true }),
  ).toHaveValue("display.toggle");
  await expect(
    page.getByLabel("Double-click macro", { exact: true }),
  ).toHaveValue("display.next_page");
  await expect(page.locator(".hardware-voltage")).toContainText(/4\.\d{2}/);
  await expect(
    page.getByText("/dev/input/event0", { exact: true }),
  ).toBeVisible();
  const session = await page.request
    .get("/api/session")
    .then((response) => response.json());
  const headers = { "X-CSRF-Token": session.csrf };
  const hardware = () =>
    page.request.get("/api/hardware").then((response) => response.json());
  const initial = await hardware();
  expect(initial.battery.charging_verified).toBe(false);
  expect(initial.battery.charge_control_available).toBe(false);
  expect(initial.device.available).toBe(true);
  expect(initial.device.state.button_available).toBe(true);
  const missingCSRF = await page.request.post("/api/action", {
    data: {
      action: "hardware.screen",
      params: { operation: "sleep" },
      confirm: true,
    },
  });
  expect(missingCSRF.status()).toBe(403);
  const unconfirmed = await page.request.post("/api/action", {
    headers,
    data: {
      action: "hardware.screen",
      params: { operation: "sleep" },
      confirm: false,
    },
  });
  expect(unconfirmed.status()).toBe(400);
  const change = async (action: string, params: Record<string, string>) => {
    const response = await page.request.post("/api/action", {
      headers,
      data: { action, params, confirm: true },
    });
    expect(response.status()).toBe(200);
    const { job } = await response.json();
    await expect
      .poll(
        async () => {
          const jobs = await page.request
            .get(`/api/jobs?selected=${job}`)
            .then((result) => result.json());
          return jobs.find((item: { id: string }) => item.id === job)?.status;
        },
        { timeout: 10000 },
      )
      .toBe("success");
  };
  const originalConfig = Object.fromEntries(
    Object.entries(initial.device.state.config).map(([key, value]) => [
      key,
      String(value),
    ]),
  );
  try {
    await page.getByRole("button", { name: "Wake", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Change only the LCD");
    await page
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
    await expect
      .poll(async () => (await hardware()).device.state.awake)
      .toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: "../.local/mf800h-hardware-desktop.png",
      fullPage: true,
    });
    await change("hardware.configure", {
      ...originalConfig,
      screen_sleep_seconds: "3",
    });
    await change("hardware.screen", { operation: "wake" });
    // Repeated GETs must not keep the panel awake.
    await expect
      .poll(async () => (await hardware()).device.state.awake, {
        timeout: 10000,
      })
      .toBe(false);
    await change("hardware.screen", { operation: "next_page" });
    const next = (await hardware()).device.state;
    expect(next.awake).toBe(true);
    expect(next.page).not.toBe(initial.device.state.page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect
      .poll(async () => {
        const box = await page.locator(".sidebar").boundingBox();
        return box ? box.x + box.width : 0;
      })
      .toBeLessThanOrEqual(0.5);
    await expect(
      page.getByRole("heading", { name: "Battery & display", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "../.local/mf800h-hardware-mobile.png",
      fullPage: true,
    });
  } finally {
    await change("hardware.configure", originalConfig);
    await change("hardware.screen", { operation: "wake" });
  }
  expect(errors).toEqual([]);
});
