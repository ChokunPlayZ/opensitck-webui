import { useState } from "react";
import { Battery, Monitor, Moon, Sun } from "lucide-react";
import { useData } from "../api";
import {
  Badge,
  Card,
  ErrorBox,
  Form,
  Input,
  KV,
  Notice,
  PageIntro,
  Refresh,
  Select,
  useActions,
} from "../components";

interface DeviceConfig {
  screen_sleep_seconds: number;
  double_click_ms: number;
  single_click: string;
  double_click: string;
}
interface Hardware {
  battery: {
    available: boolean;
    voltage_v: number | null;
    health: string;
    reported_status: string;
    uncalibrated_capacity_percent: number | null;
    design_capacity_mah: number | null;
    design_energy_wh: number | null;
    design_max_voltage_v: number | null;
  };
  device: {
    available: boolean;
    error: string;
    state: {
      config: DeviceConfig;
      awake: boolean;
      page: string;
      sleep_in_seconds: number | null;
      button_available: boolean;
      button_error: string;
      input_device: string;
      last_gesture: string;
      clicks: { single_click: number; double_click: number };
      macro_running: boolean;
      last_macro_error: string;
    } | null;
  };
}
const macros: [string, string][] = [
  ["display.toggle", "Wake / sleep screen"],
  ["display.wake", "Wake screen"],
  ["display.sleep", "Sleep screen"],
  ["display.next_page", "Next status page"],
  ["display.previous_page", "Previous status page"],
  ["none", "Do nothing"],
  ["hook", "Custom root-owned script"],
];

export default function BatteryDisplay() {
  const { data, error, reload } = useData<Hardware>("hardware", 3000);
  const [draft, setDraft] = useState<DeviceConfig | null>(null);
  const { act } = useActions();
  const battery = data?.battery;
  const device = data?.device;
  const state = device?.state;
  const config = draft ?? state?.config;
  const update = (values: Partial<DeviceConfig>) => {
    if (config) setDraft({ ...config, ...values });
  };
  const screenAction = (operation: string) =>
    act(
      "hardware.screen",
      { operation },
      "Change only the LCD screen. Linux, Wi-Fi and the WebUI keep running.",
    );
  return (
    <>
      <PageIntro
        eyebrow="DEVICE HARDWARE"
        title="Battery & display"
        description="Read-only battery telemetry, screen sleep and side-button macros. Managed by an independent daemon."
      >
        <Refresh onClick={reload} />
      </PageIntro>
      <ErrorBox error={error} />
      <div className="grid equal">
        <div className="stack">
          <Card
            title="Battery"
            subtitle="MF800H · Li-ion · 3.8 V nominal"
            actions={<Battery size={20} />}
          >
            {!battery?.available ? (
              <Notice>Battery telemetry is unavailable on this device.</Notice>
            ) : (
              <>
                <div className="hardware-voltage">
                  {battery.voltage_v?.toFixed(2) ?? "—"}
                  <small> V</small>
                </div>
                <KV
                  rows={[
                    ["Battery health", battery.health || "Unknown"],
                    [
                      "Design capacity",
                      battery.design_capacity_mah == null
                        ? "—"
                        : `${battery.design_capacity_mah} mAh`,
                    ],
                    [
                      "Design energy",
                      battery.design_energy_wh == null
                        ? "—"
                        : `${battery.design_energy_wh.toFixed(2)} Wh`,
                    ],
                    [
                      "Cell maximum (label)",
                      battery.design_max_voltage_v == null
                        ? "—"
                        : `${battery.design_max_voltage_v.toFixed(2)} V`,
                    ],
                    [
                      "Kernel-reported status",
                      battery.reported_status || "Unknown",
                    ],
                    [
                      "Uncalibrated estimate",
                      battery.uncalibrated_capacity_percent == null
                        ? "Unavailable"
                        : `${battery.uncalibrated_capacity_percent}% (not validated)`,
                    ],
                  ]}
                />
                <Notice>
                  Charging is unmanaged by this console and active charging is
                  not yet verified. The kernel status has no charger-supplier
                  link; it does not prove current direction. The inherited
                  percentage estimate is uncalibrated. Voltage is the primary
                  reading. No charger registers are written and no percentage
                  charge limit is enabled.
                </Notice>
              </>
            )}
          </Card>
          <Card
            title="Display"
            subtitle="128 × 128 GC9107 · screen-only sleep"
            actions={<Monitor size={20} />}
          >
            <ErrorBox error={device?.error} />
            {state && (
              <KV
                rows={[
                  [
                    "Screen",
                    <Badge tone={state.awake ? "green" : "neutral"}>
                      {state.awake ? "Awake" : "Sleeping"}
                    </Badge>,
                  ],
                  ["Status page", state.page],
                  [
                    "Sleep countdown",
                    state.sleep_in_seconds == null
                      ? "Off / already asleep"
                      : `${state.sleep_in_seconds} seconds`,
                  ],
                  ["Daemon", "openstick-device.service"],
                ]}
              />
            )}
            <div className="inline-actions">
              <button
                disabled={!device?.available}
                onClick={() => screenAction("wake")}
              >
                <Sun size={15} />
                Wake
              </button>
              <button
                disabled={!device?.available}
                onClick={() => screenAction("sleep")}
              >
                <Moon size={15} />
                Sleep
              </button>
              <button
                disabled={!device?.available}
                onClick={() => screenAction("next_page")}
              >
                Next page
              </button>
            </div>
            <p className="muted">
              Sleep blacks out the LCD, turns off its backlight and pauses
              drawing. It does not suspend Linux. WebUI polling does not wake
              the screen. Pages: overview, ISP, transfers, clients, Wi-Fi QR,
              network and battery.
            </p>
          </Card>
        </div>
        <div className="stack">
          <Card
            title="Screen sleep & button macros"
            subtitle="Saved on the device; works with the WebUI stopped"
          >
            {config && (
              <Form
                submit="Save hardware settings"
                onSubmit={() =>
                  act(
                    "hardware.configure",
                    {
                      screen_sleep_seconds: String(config.screen_sleep_seconds),
                      double_click_ms: String(config.double_click_ms),
                      single_click: config.single_click,
                      double_click: config.double_click,
                    },
                    "Save screen timeout and side-button mappings in the independent device daemon?",
                  )
                }
              >
                <Input
                  label="Screen timeout (seconds; 0 = never)"
                  type="number"
                  min={0}
                  max={86400}
                  required
                  value={config.screen_sleep_seconds}
                  onChange={(e) =>
                    update({ screen_sleep_seconds: Number(e.target.value) })
                  }
                />
                <Select
                  label="Single-click macro"
                  options={macros}
                  value={config.single_click}
                  onChange={(e) => update({ single_click: e.target.value })}
                />
                <Select
                  label="Double-click macro"
                  options={macros}
                  value={config.double_click}
                  onChange={(e) => update({ double_click: e.target.value })}
                />
                <Input
                  label="Double-click window (milliseconds)"
                  type="number"
                  min={200}
                  max={800}
                  required
                  value={config.double_click_ms}
                  onChange={(e) =>
                    update({ double_click_ms: Number(e.target.value) })
                  }
                />
              </Form>
            )}
            <p className="muted">
              Single-click waits for the double-click window; a double-click
              does not also fire the single-click macro. Long holds do not
              trigger these macros. Hold for about 1.2 seconds, then release to
              open the LCD power-off prompt: double-click to confirm or
              single-click to cancel. It cancels after 10 seconds. Release as
              soon as prompted; the hardware’s forced long-hold action remains
              unchanged.
            </p>
            <Notice>
              Advanced custom macros use fixed executable files:{" "}
              <code>/etc/openstick-device/macros/single-click</code> and{" "}
              <code>/etc/openstick-device/macros/double-click</code>. Create
              them through SSH or the root file editor, owned by root, with mode
              0700. Each runs without shell interpolation, one at a time, with a
              10-second limit. A custom macro runs as root.
            </Notice>
          </Card>
          <Card title="Side-button diagnostics">
            <ErrorBox error={state?.button_error || state?.last_macro_error} />
            <KV
              rows={[
                [
                  "Power key",
                  state?.button_available ? state.input_device : "Unavailable",
                ],
                [
                  "Last gesture",
                  state?.last_gesture.replaceAll("_", " ") || "None yet",
                ],
                ["Single-clicks", state?.clicks.single_click ?? "—"],
                ["Double-clicks", state?.clicks.double_click ?? "—"],
                ["Custom macro", state?.macro_running ? "Running" : "Idle"],
              ]}
            />
            <p className="muted">
              Counters reset when the device daemon restarts, not when the WebUI
              restarts. No action here changes Wi-Fi or charging.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
