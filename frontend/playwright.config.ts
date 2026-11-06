import { defineConfig } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

const accessPath = new URL("../.local/access.json", import.meta.url);
const access = existsSync(accessPath)
  ? JSON.parse(readFileSync(accessPath, "utf8"))
  : {};
const baseURL = process.env.WEBUI_URL || access.url;
if (!baseURL) {
  throw new Error("Set WEBUI_URL explicitly for opt-in live-device tests");
}

export default defineConfig({
  testDir: "./tests",
  testMatch: ["device.spec.ts", "hardware.spec.ts", "management.spec.ts"],
  timeout: 90000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    ignoreHTTPSErrors: true, // Verify the device certificate separately over pinned SSH.
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
});
