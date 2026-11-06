import { test, expect, type Page } from "@playwright/test";
import type { Profile } from "../../src/api";

interface TestJob {
  id: string;
  label: string;
  status: string;
  started: string;
  finished?: string;
  output: string;
}
const previousResult = {
  time: "2026-11-01T08:00:00Z",
  provider: "Cloudflare",
  latencyMS: 30,
  downloadMbps: 12,
  uploadMbps: 5,
  downloadBytes: 25 * 1024 ** 2,
  uploadBytes: 10 * 1024 ** 2,
};

async function device(page: Page, username = "user") {
  const state = {
    jobs: [] as TestJob[],
    actions: [] as string[],
    reads: {} as Record<string, number>,
    wifi: [["", "Cached network", "65", "WPA2", "6", "2.4 GHz"]],
    radio: "enabled",
    profiles: [] as Profile[],
    hotspotBridge: "",
    managementURL: "",
    packages: [["nano", "8.0", "ii"]],
    result: { ...previousResult },
    jobError: "",
    actionError: "",
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice(5);
    state.reads[path] = (state.reads[path] || 0) + 1;
    let json: unknown = {};
    switch (path) {
      case "session":
        json = { authenticated: true, csrf: "test-csrf", username };
        break;
      case "status":
        json = { system: { hostname: "OpenStick" }, history: [] };
        break;
      case "network":
        json = {
          radio: state.radio,
          wifi: state.wifi,
          profiles: state.profiles,
          hotspotBridge: state.hotspotBridge,
          managementURL: state.managementURL,
        };
        break;
      case "packages":
        json = { packages: state.packages };
        break;
      case "jobs": {
        if (state.jobError) {
          await route.fulfill({ status: 503, json: { error: state.jobError } });
          return;
        }
        const selected = url.searchParams.get("selected") || state.jobs[0]?.id;
        json = state.jobs.map((job) => ({
          ...job,
          output: selected === job.id ? job.output : "",
        }));
        break;
      }
      case "speedtest": {
        const job = state.jobs.find((item) => item.label === "speedtest.run");
        json = {
          status: job?.status || "idle",
          job: job?.id || "",
          result: state.result,
          error:
            job?.status === "failed"
              ? "The latest test did not complete. Previous successful result preserved."
              : "",
        };
        break;
      }
      case "action": {
        if (state.actionError) {
          await route.fulfill({
            status: 400,
            json: { error: state.actionError },
          });
          return;
        }
        const body = route.request().postDataJSON();
        expect(body.confirm).toBe(true);
        expect(route.request().headers()["x-csrf-token"]).toBe("test-csrf");
        state.actions.push(body.action);
        const id = `job-${state.actions.length}`;
        state.jobs.unshift({
          id,
          label: body.action,
          status: "running",
          started: new Date().toISOString(),
          output:
            body.action === "speedtest.run"
              ? "Measuring HTTPS latency (3 requests)…\n"
              : "Running on the device…\n",
        });
        json = { job: id };
        break;
      }
    }
    await route.fulfill({ json });
  });
  return state;
}

test("terminal identifies the signed-in account instead of hard-coding root", async ({
  page,
}) => {
  await device(page, "operator-admin");
  await page.routeWebSocket(/\/api\/terminal\?/, (socket) => {
    socket.send("operator-admin@openstick:~$ ");
  });
  await page.goto("/#terminal");
  await expect(
    page.getByText("Connected · operator-admin", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("operator-admin@openstick · login shell", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("main .notice")).toHaveCount(0);
  await expect(page.getByText("Connected · root", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(
    page.getByText("Connected · operator-admin", { exact: true }),
  ).toBeVisible();
});

test("MF800H AP creation explains shared LAN access without allowing the uplink", async ({
  page,
}) => {
  const state = await device(page);
  state.hotspotBridge = "br0";
  state.managementURL = "https://192.168.100.1";
  await page.goto("/#wifi");
  await page.getByRole("button", { name: "Access point", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "https://192.168.100.1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Wi-Fi client mode and cellular remain excluded", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Network name (SSID)", { exact: true })
    .fill("Test downlink AP");
  await page
    .getByLabel("WPA password", { exact: true })
    .fill("not-a-real-password");
  await page
    .getByRole("button", { name: "Start access point", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("https://192.168.100.1");
  await expect(page.getByRole("dialog")).toContainText(
    "preferred after reboot",
  );
  expect(state.actions).toEqual([]);
  const posted = page.waitForRequest((request) =>
    request.url().endsWith("/api/action"),
  );
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  const body = (await posted).postDataJSON();
  expect(body.action).toBe("wifi.hotspot");
  expect(body.params.ssid).toBe("Test downlink AP");
  expect(body.params.interface).toBe("wlan0");
});

test("saved Wi-Fi disconnect and reconnect explain persistent boot choices", async ({
  page,
}) => {
  const state = await device(page);
  state.profiles = [
    {
      name: "Saved client",
      uuid: "c45ef127-9d41-4c28-87fb-49ad65463d78",
      type: "802-11-wireless",
      device: "wlan0",
      autoconnect: "yes",
    },
  ];
  await page.goto("/#wifi");
  await page
    .getByRole("button", { name: "Saved networks", exact: true })
    .click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "disables its autoconnect",
  );
  expect(state.actions).toEqual([]);
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect.poll(() => state.actions).toEqual(["profile.down"]);
  state.profiles[0].device = "";
  state.profiles[0].autoconnect = "no";
  finish(state.jobs[0]);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "preferred after reboot",
  );
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect
    .poll(() => state.actions)
    .toEqual(["profile.down", "profile.up"]);
});

function finish(job: TestJob, status = "success") {
  job.status = status;
  job.finished = new Date().toISOString();
}

test("Wi-Fi scans stay inline, prevent duplicates and refresh results once on completion", async ({
  page,
}) => {
  const state = await device(page);
  await page.goto("/#wifi");
  await expect(page.getByText("Cached network", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Scan networks", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Scanning…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Looking for nearby networks" }),
  ).toContainText("Results will update here automatically");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.actions).toEqual(["wifi.scan"]);

  state.wifi.push(["", "Fresh network", "93", "WPA3", "11", "2.4 GHz"]);
  finish(state.jobs[0]);
  await expect(page.getByText("Fresh network", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(
    page.getByRole("region", { name: "Scan complete", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Scan networks", exact: true }),
  ).toBeEnabled();
  expect(state.reads.network).toBe(2);
  // Finished-job metadata polls must not continuously re-read the device.
  await page.waitForResponse((response) =>
    response.url().includes("jobs?selected=none"),
  );
  expect(state.reads.network).toBe(2);
  await page.getByRole("button", { name: /Fresh network/ }).click();
  await expect(
    page.getByLabel("Network name (SSID)", { exact: true }),
  ).toHaveValue("Fresh network");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("failed Wi-Fi scans show the actual error, keep cached networks and allow retry", async ({
  page,
}) => {
  const state = await device(page);
  await page.goto("/#wifi");
  await page
    .getByRole("button", { name: "Scan networks", exact: true })
    .click();
  await expect.poll(() => state.jobs.length).toBe(1);
  state.jobs[0].output = "Error: NetworkManager is unavailable";
  finish(state.jobs[0], "failed");
  await expect(page.locator(".operation-output")).toContainText(
    "NetworkManager is unavailable",
    { timeout: 10000 },
  );
  await expect(page.getByText("Cached network", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Scan networks", exact: true })
    .click();
  await expect.poll(() => state.actions.length).toBe(2);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("speed tests retain data-use confirmation and show real phases and measurements on the page", async ({
  page,
}) => {
  const state = await device(page);
  await page.goto("/#speedtest");
  const start = page.getByRole("button", {
    name: "Start speed test",
    exact: true,
  });
  await start.click();
  await expect(page.getByRole("dialog")).toContainText("35 MiB");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.actions).toEqual([]);
  await start.click();
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Measuring latency", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Test in progress…", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const metric = (label: string) =>
    page
      .locator(".speedtest-metrics .metric-card")
      .filter({ hasText: label })
      .locator("strong");
  await expect(metric("Download")).toHaveText("—");
  await expect(
    page.getByText("12.00 Mbps down · 5.00 Mbps up · 30.0 ms"),
  ).toBeVisible();
  state.jobs[0].output += "Latency: 19.2 ms\nDownloading…\n";
  await expect(
    page.getByRole("heading", { name: "Measuring download", exact: true }),
  ).toBeVisible();
  await expect(metric("Latency")).toHaveText("19.2 ms");
  state.jobs[0].output += "Download: 8.75 Mbps\nUploading…\n";
  await expect(
    page.getByRole("heading", { name: "Measuring upload", exact: true }),
  ).toBeVisible();
  await expect(metric("Download")).toHaveText("8.75 Mbps");
  await page.screenshot({
    path: "test-results/speedtest-inline-desktop.png",
    fullPage: true,
  });
  state.jobs[0].output += "Upload: 4.25 Mbps\nComplete.\n";
  state.result = {
    ...previousResult,
    time: new Date().toISOString(),
    downloadMbps: 8.75,
    uploadMbps: 4.25,
    latencyMS: 19.2,
  };
  finish(state.jobs[0]);
  await expect(
    page.getByRole("heading", { name: "Test complete", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(metric("Upload")).toHaveText("4.25 Mbps");
  await expect(start).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("speed-test errors are expanded inline without replacing the last successful readings", async ({
  page,
}) => {
  const state = await device(page);
  state.jobs.push({
    id: "failed-speedtest",
    label: "speedtest.run",
    status: "failed",
    started: new Date().toISOString(),
    output: "Error: latency: DNS lookup failed",
  });
  await page.goto("/#speedtest");
  await expect(
    page.getByRole("heading", { name: "Test could not complete", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".test-output .code")).toContainText(
    "DNS lookup failed",
  );
  await expect(
    page
      .locator(".speedtest-metrics .metric-card")
      .filter({ hasText: "Download" })
      .locator("strong"),
  ).toHaveText("12.00 Mbps");
  await expect(
    page.getByRole("button", { name: "Start speed test", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("other operations stream inline, survive navigation and refresh without opening Activity", async ({
  page,
}) => {
  const state = await device(page);
  await page.goto("/#packages");
  await page.getByLabel("Package names (space-separated)").fill("tcpdump");
  await page
    .getByRole("button", { name: "Install packages", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Package installation", exact: true }),
  ).toContainText("Running on the device…");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .locator("nav")
    .getByRole("button", { name: "Wi-Fi", exact: true })
    .click();
  await expect(page.locator(".activity-count")).toHaveText("1");
  state.packages.push(["tcpdump", "4.99", "ii"]);
  state.jobs[0].output += "tcpdump installed successfully\n";
  finish(state.jobs[0]);
  await expect(page.locator(".activity-count")).toHaveCount(0, {
    timeout: 10000,
  });
  await page
    .locator("nav")
    .getByRole("button", { name: "Packages", exact: true })
    .click();
  await expect(
    page.locator("td").getByText("tcpdump", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Package installation", exact: true }),
  ).toContainText("Completed");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Activity is still available deliberately, without triggering reload loops.
  const reads = state.reads.packages;
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Device activity" }),
  ).toContainText("tcpdump installed successfully");
  await page.waitForResponse((response) =>
    response.url().includes("jobs?selected="),
  );
  expect(state.reads.packages).toBe(reads);
});

test("scan validation and lost job polling are visible instead of pretending an operation completed", async ({
  page,
}) => {
  const state = await device(page);
  await page.goto("/#wifi");
  state.actionError = "Wi-Fi device is not available";
  await page
    .getByRole("button", { name: "Scan networks", exact: true })
    .click();
  await expect(page.locator(".card-body .notice")).toContainText(
    "Wi-Fi device is not available",
  );
  await expect(
    page.getByRole("button", { name: "Scan networks", exact: true }),
  ).toBeEnabled();
  state.actionError = "";
  await page
    .getByRole("button", { name: "Scan networks", exact: true })
    .click();
  await expect.poll(() => state.jobs.length).toBe(1);
  state.jobError = "Device disconnected";
  await expect(page.getByText(/Cannot update operation status/)).toContainText(
    "Device disconnected",
    { timeout: 10000 },
  );
  await expect(
    page.getByRole("button", { name: "Scanning…", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("Cached network", { exact: true })).toBeVisible();
});

test("inline scan and speed-test layouts fit mobile screens", async ({
  page,
}) => {
  const state = await device(page);
  await page.setViewportSize({ width: 390, height: 844 });
  state.wifi[0][1] = "An unusually long nearby wireless network name";
  await page.goto("/#wifi");
  await page
    .getByRole("button", { name: "Scan networks", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Looking for nearby networks" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/wifi-inline-mobile.png",
    fullPage: true,
  });
  await page.goto("/#speedtest");
  await page
    .getByRole("button", { name: "Start speed test", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Measuring latency", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/speedtest-inline-mobile.png",
    fullPage: true,
  });
});
