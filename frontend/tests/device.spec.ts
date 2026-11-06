import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

const accessPath = new URL("../../.local/access.json", import.meta.url);
const access = existsSync(accessPath)
  ? JSON.parse(readFileSync(accessPath, "utf8"))
  : {};
const username = process.env.WEBUI_USERNAME || access.username || "user";
const password = process.env.WEBUI_PASSWORD;
if (!password)
  throw new Error(
    "Set WEBUI_PASSWORD to the existing Debian account password before running device tests.",
  );

test("device terminal: signed-in account, permissions, Ctrl-C and reconnect", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#terminal");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Open console" }).click();
  await expect(
    page.getByText(`Connected · ${username}`, { exact: true }),
  ).toBeVisible();
  const accounts = await page.request
    .get("/api/users")
    .then((response) => response.json());
  const account = accounts.users.find(
    (user: any) => user.username === username,
  );
  expect(account).toBeTruthy();
  await expect(page.locator("main .notice")).toHaveCount(0);
  const rows = page.locator(".xterm-rows");
  async function command(script: string) {
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type(script);
    await page.keyboard.press("Enter");
  }
  await command(
    'printf \'WEBUI_%s:%s:%s:%s:%s:%s:%s\\n\' IDENTITY "$(id -un)" "$(id -u)" "$(id -g)" "$HOME" "$PWD" "$SHELL"',
  );
  await expect(rows).toContainText(
    `WEBUI_IDENTITY:${username}:${account.uid}:${account.gid}:${account.home}:${account.home}:${account.shell}`,
  );
  await command(
    "printf 'WEBUI_%s:%s\\n' GROUPS \"$(id -Gn | tr ' ' '\\n' | sort | tr '\\n' ',')\"",
  );
  await expect(rows).toContainText(`WEBUI_GROUPS:${account.groups.join(",")},`);
  await command(
    "if test -r /var/lib/openstick-webui/tls/key.pem; then printf 'WEBUI_%s\\n' PRIVATE_KEY_READABLE; else printf 'WEBUI_%s\\n' PRIVATE_KEY_DENIED; fi",
  );
  await expect(rows).toContainText(
    account.uid === 0
      ? "WEBUI_PRIVATE_KEY_READABLE"
      : "WEBUI_PRIVATE_KEY_DENIED",
  );
  await command("printf 'WEBUI_%s\\n' SLEEP_READY; sleep 30");
  await expect(rows).toContainText("WEBUI_SLEEP_READY");
  await page.keyboard.press("Control+c");
  await command("printf 'WEBUI_%s\\n' INTERRUPTED");
  await expect(rows).toContainText("WEBUI_INTERRUPTED", { timeout: 5000 });
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(
    page.getByText(`Connected · ${username}`, { exact: true }),
  ).toBeVisible();
  // The WebSocket opens before PAM has finished preparing the login shell.
  await expect(rows).toContainText(/[$#>%] /);
  await command("printf 'WEBUI_%s:%s\\n' RECONNECTED \"$(id -un)\"");
  await expect(rows).toContainText(`WEBUI_RECONNECTED:${username}`);
  await page.screenshot({
    path: testInfo.outputPath("terminal-user.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const box = await page.locator(".sidebar").boundingBox();
      return box ? box.x + box.width : 0;
    })
    .toBeLessThanOrEqual(0.5);
  await page.screenshot({
    path: testInfo.outputPath("terminal-user-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("button", { name: /Sign out/ }).click();
  await expect(
    page.getByRole("button", { name: "Open console" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("live device console: authentication, every section, mobile, terminal and temporary file", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const unauthenticated = await request.get("/api/status");
  expect(unauthenticated.status()).toBe(401);
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Open console" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Small form.")).toBeVisible();
  await expect(
    page.getByText("Insert a SIM to get started", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../.local/overview-desktop.png",
    fullPage: true,
  });

  const sections = [
    ["Cellular & SIM", "Cellular & SIM"],
    ["Wi-Fi", "Wi-Fi"],
    ["Network", "Network"],
    ["Speed test", "Speed test"],
    ["WireGuard", "WireGuard"],
    ["Firewall", "Firewall"],
    ["Services", "Services"],
    ["Logs", "Logs"],
    ["Files & config", "Files & configuration"],
    ["Packages", "Packages"],
    ["User manager", "User manager"],
    ["System", "System"],
  ];
  for (const [navigation, title] of sections) {
    await page
      .locator("nav")
      .getByRole("button", { name: navigation, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    // Wait for this page's initial data read to finish, rather than just its title.
    await expect(
      page.getByText("Reading device…", { exact: true }),
    ).toHaveCount(0, { timeout: 30000 });
  }

  // New management controls are inspected without consuming data or changing accounts.
  await page
    .locator("nav")
    .getByRole("button", { name: "Speed test", exact: true })
    .click();
  const startTest = page.getByRole("button", {
    name: "Start speed test",
    exact: true,
  });
  await expect(startTest).toBeEnabled();
  await startTest.click();
  await expect(page.getByRole("dialog")).toContainText("35 MiB");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(startTest).toBeEnabled();
  await page
    .locator("nav")
    .getByRole("button", { name: "User manager", exact: true })
    .click();
  const ownRow = page.locator("tr").filter({ hasText: `${username} (you)` });
  await expect(ownRow).toBeVisible();
  if (username !== "root") {
    await ownRow.getByRole("button", { name: "Manage", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Lock password", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", {
        name: "Delete account (keep files)",
        exact: true,
      }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  }
  await page
    .getByLabel("New username", { exact: true })
    .fill("webui_cancelled_test");
  await page
    .getByLabel("Initial password", { exact: true })
    .fill("not-a-real-account-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("webui_cancelled_test");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.locator("tr").filter({ hasText: "webui_cancelled_test" }),
  ).toHaveCount(0);

  await page
    .locator("nav")
    .getByRole("button", { name: "Cellular & SIM", exact: true })
    .click();
  await expect(
    page.getByText("The modem reports no SIM card.", { exact: false }),
  ).toBeVisible();
  for (const tab of [
    "APN & connection",
    "SIM security",
    "SMS",
    "Radio & advanced",
    "Status",
  ]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(page.locator("main .tabs button.active")).toHaveText(tab);
  }
  await page
    .locator("nav")
    .getByRole("button", { name: "Network", exact: true })
    .click();
  await expect(page.getByText("usb", { exact: true }).first()).toBeVisible({
    timeout: 30000,
  });
  await page
    .locator("tr")
    .filter({ hasText: process.env.WEBUI_TEST_CONNECTION || "usb" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "IPv4", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "ipv4.method", exact: true }),
  ).toHaveValue(/^(auto|manual|shared|disabled|link-local)$/);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();

  // A real PTY roundtrip. No device configuration is changed.
  await page
    .locator("nav")
    .getByRole("button", { name: /^Web terminal/ })
    .click();
  await expect(
    page.getByText(`Connected · ${username}`, { exact: true }),
  ).toBeVisible();
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type(
    'printf \'WEBUI_PTY_%s:%s:%s:%s\\n\' VERIFIED "$(id -un)" "$HOME" "$PWD"',
  );
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    `WEBUI_PTY_VERIFIED:${username}:`,
    { timeout: 10000 },
  );
  await page.screenshot({ path: "../.local/terminal.png", fullPage: true });

  // Isolated filesystem roundtrip under /tmp, removed again immediately.
  const session = await page.request
    .get("/api/session")
    .then((response) => response.json());
  const headers = { "X-CSRF-Token": session.csrf };
  const path = `/tmp/openstick-webui-test-${Date.now()}.txt`;
  const saved = await page.request.post("/api/file", {
    headers,
    data: { path, content: "OpenStick integration test\n", confirm: true },
  });
  expect(saved.status()).toBe(200);
  const file = await page.request
    .get(`/api/file?path=${encodeURIComponent(path)}`)
    .then((response) => response.json());
  expect(file.content).toBe("OpenStick integration test\n");
  const removed = await page.request.post("/api/action", {
    headers,
    data: { action: "file.delete", params: { path }, confirm: true },
  });
  expect(removed.status()).toBe(200);

  await page
    .locator("nav")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page
    .locator("nav")
    .getByRole("button", { name: "System", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "System", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const box = await page.locator(".sidebar").boundingBox();
      return box ? box.x + box.width : 0;
    })
    .toBeLessThanOrEqual(0.5);
  await expect(
    page.getByText("Installed", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reboot device", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Confirm device change" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: "../.local/mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("device API: safe read endpoints, CSRF, keys, backup and diagnostic job", async ({
  request,
}) => {
  const login = await request.post("/api/login", {
    data: { username, password },
  });
  expect(login.status()).toBe(200);
  const { csrf } = await login.json();
  const headers = { "X-CSRF-Token": csrf };
  for (const endpoint of [
    "status",
    "capabilities",
    "network",
    "modem",
    "services",
    "wireguard",
    "firewall",
    "files?path=/etc",
    "storage",
    "packages",
    "processes",
    "system",
    "users",
    "speedtest",
    "jobs",
    "logs?lines=3",
    "audit",
  ]) {
    const response = await request.get(`/api/${endpoint}`);
    expect(response.status(), endpoint).toBe(200);
    expect(await response.json(), endpoint).not.toBeNull();
  }
  const users = await request
    .get("/api/users")
    .then((response) => response.json());
  expect(users.currentUser).toBe(username);
  expect(
    users.users.find((user: any) => user.username === "root")?.editable,
  ).toBe(false);
  for (const [action, params] of [
    ["user.lock", { user: username }],
    ["user.delete", { user: username }],
    ["user.delete", { user: "root" }],
    ["user.sudo", { user: username, enabled: "false" }],
  ]) {
    const rejected = await request.post("/api/action", {
      headers,
      data: { action, params, confirm: true },
    });
    expect(rejected.status(), String(action)).toBe(400);
  }
  const unconfirmedSpeedtest = await request.post("/api/action", {
    headers,
    data: { action: "speedtest.run", params: {} },
  });
  expect(unconfirmedSpeedtest.status()).toBe(400);
  const noCSRF = await request.post("/api/action", {
    data: { action: "diagnostic", params: { host: "localhost", type: "dns" } },
  });
  expect(noCSRF.status()).toBe(403);
  const invalidFirewall = await request.post("/api/action", {
    headers,
    data: {
      action: "firewall.save",
      params: { config: "flush ruleset" },
      confirm: true,
    },
  });
  expect(invalidFirewall.status()).toBe(400);
  const keysResponse = await request.post("/api/wireguard/keys", {
    headers,
    data: {},
  });
  expect(keysResponse.status()).toBe(200);
  const keys = await keysResponse.json();
  expect(keys.private).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  expect(keys.public).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  const backup = await request.get("/api/backup");
  expect(backup.status()).toBe(200);
  expect(backup.headers()["content-type"]).toBe("application/gzip");
  expect((await backup.body()).subarray(0, 2)).toEqual(
    Buffer.from([0x1f, 0x8b]),
  );
  const diagnostic = await request.post("/api/action", {
    headers,
    data: { action: "diagnostic", params: { host: "localhost", type: "dns" } },
  });
  const jobID = (await diagnostic.json()).job;
  expect(jobID).toBeTruthy();
  await expect
    .poll(async () => {
      const jobs = await request
        .get("/api/jobs")
        .then((response) => response.json());
      return jobs.find((job: any) => job.id === jobID)?.status;
    })
    .toBe("success");
});
