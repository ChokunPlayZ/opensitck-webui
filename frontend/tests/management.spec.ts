import { test, expect } from "@playwright/test";

test("LAN-only management keeps USB and bridged hotspot controls while uplink ports reject connections", async ({
  page,
  request,
}) => {
  const password = process.env.WEBUI_PASSWORD;
  const uplink = process.env.WEBUI_UPLINK_URL;
  test.skip(!uplink, "Set WEBUI_UPLINK_URL to test management isolation");
  if (!password) throw new Error("Set WEBUI_PASSWORD to the Debian password");
  const https = new URL("/api/session", uplink!);
  https.protocol = "https:";
  const http = new URL(https);
  http.protocol = "http:";
  for (const url of [http, https]) {
    await expect(
      request.get(url.toString(), { timeout: 3000 }),
    ).rejects.toThrow();
  }
  await page.goto("/#hardware");
  await page
    .getByLabel("Username", { exact: true })
    .fill(process.env.WEBUI_USERNAME || "user");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Open console", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Battery & display", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Single-click macro", { exact: true }),
  ).toHaveValue("display.toggle");
  const response = await page.request.get("/api/hardware");
  expect(response.status()).toBe(200);
  const hardware = await response.json();
  expect(hardware.device.available).toBe(true);
  expect(hardware.device.state.button_available).toBe(true);
  expect(hardware.device.state.config.screen_sleep_seconds).toBe(60);
  expect(hardware.battery.available).toBe(true);
  await page
    .locator("nav")
    .getByRole("button", { name: "Wi-Fi", exact: true })
    .click();
  await page.getByRole("button", { name: "Access point", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "https://192.168.100.1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Wi-Fi client mode and cellular remain excluded", {
      exact: false,
    }),
  ).toBeVisible();
});
