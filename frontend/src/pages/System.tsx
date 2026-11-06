import { useRef, useState } from "react";
import { Download, HardDrive, Power, RotateCw, Upload } from "lucide-react";
import { api, upload, useData } from "../api";
import {
  Badge,
  Card,
  Code,
  ErrorBox,
  Field,
  Form,
  Input,
  KV,
  Notice,
  PageIntro,
  Refresh,
  Select,
  Tabs,
  useActions,
} from "../components";
import { TextEditor } from "./Files";

const configurationFiles = [
  "/etc/hosts",
  "/etc/ssh/sshd_config",
  "/etc/NetworkManager/NetworkManager.conf",
  "/etc/dnsmasq.conf",
  "/etc/hostapd/hostapd.conf",
  "/etc/nftables.conf",
  "/etc/sysctl.conf",
  "/etc/fstab",
  "/etc/apt/sources.list.d/debian.sources",
  "/etc/default/locale",
  "/etc/systemd/system/openstick-webui.service",
];

export default function System() {
  const { data, error, reload } = useData("system");
  const storage = useData("storage");
  const { act, notify, confirm } = useActions();
  const [tab, setTab] = useState("General"),
    [hostname, setHostname] = useState(""),
    [timezone, setTimezone] = useState("Asia/Bangkok"),
    [cron, setCron] = useState<string | null>(null);
  const [linuxUser, setLinuxUser] = useState("user"),
    [linuxPassword, setLinuxPassword] = useState("");
  const [editing, setEditing] = useState<{
      path: string;
      content: string;
    } | null>(null),
    [diagnostic, setDiagnostic] = useState({ type: "ping", host: "1.1.1.1" });
  const restoreInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <PageIntro
        eyebrow="ADMINISTRATION"
        title="System"
        description="Device settings, security, maintenance and recovery."
      >
        <Refresh
          onClick={() => {
            reload();
            storage.reload();
          }}
        />
      </PageIntro>
      <ErrorBox error={error} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          "General",
          "Console security",
          "Backups & storage",
          "Diagnostics",
          "Advanced",
        ]}
      />
      {tab === "General" && (
        <div className="grid equal">
          <div className="stack">
            <Card title="Device identity">
              <Form onSubmit={() => act("system.hostname", { hostname })}>
                <Input
                  label="Hostname"
                  value={hostname}
                  placeholder={data?.hostname || "openstick-debian"}
                  required
                  onChange={(event) => setHostname(event.target.value)}
                />
              </Form>
            </Card>
            <Card title="Time & synchronization">
              <Code>{data?.time}</Code>
              <Form
                submit="Set timezone"
                onSubmit={() => act("system.timezone", { timezone })}
              >
                <Input
                  label="IANA timezone"
                  value={timezone}
                  required
                  onChange={(event) => setTimezone(event.target.value)}
                />
              </Form>
              <div className="inline-actions">
                <button onClick={() => act("system.ntp", { enabled: "true" })}>
                  Enable NTP
                </button>
                <button onClick={() => act("system.ntp", { enabled: "false" })}>
                  Disable NTP
                </button>
              </div>
            </Card>
          </div>
          <div className="stack">
            <Card title="Power controls">
              <Notice>
                Reboot interrupts all connections. After shutdown, unplug and
                replug the stick to start it again.
              </Notice>
              <div className="inline-actions">
                <button
                  onClick={() =>
                    act(
                      "system.reboot",
                      {},
                      "Reboot the stick now? All network connections and services will be interrupted.",
                    )
                  }
                >
                  <RotateCw size={15} />
                  Reboot device
                </button>
                <button
                  className="danger-text"
                  onClick={() =>
                    act(
                      "system.poweroff",
                      {},
                      "Shut down the stick? You must physically unplug/replug it to boot again.",
                    )
                  }
                >
                  <Power size={15} />
                  Shut down
                </button>
              </div>
            </Card>
            <Card
              title="Capabilities"
              subtitle="Detected executables on this device"
            >
              <div className="capability-grid">
                {Object.entries(data?.capabilities || {}).map(
                  ([name, supported]) => (
                    <div key={name}>
                      <span className="mono">{name}</span>
                      <Badge tone={supported ? "green" : "neutral"}>
                        {supported ? "Installed" : "Absent"}
                      </Badge>
                    </div>
                  ),
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
      {tab === "Console security" && (
        <div className="grid equal">
          <Card
            title="Debian account authentication"
            subtitle="One account and password for Debian, SSH and this console"
          >
            <Notice>
              Port 80 redirects to HTTPS on port 443. The default certificate is
              self-signed: verify its SHA-256 fingerprint through SSH before
              trusting the browser warning. Keep this root console on trusted
              management networks. Sessions expire after 12 hours.
            </Notice>
            <KV
              rows={[
                ["Authentication", "Local Debian OpenSSH / PAM"],
                ["Password database", "Debian system accounts only"],
                ["Required privileges", "UID 0 or sudo permission for /bin/sh"],
                ["Session lifetime", "12 hours"],
              ]}
            />
            <Notice>
              The console does not store a separate password or copy
              /etc/shadow. Passwords are verified through sshd on 127.0.0.1:22,
              with its host key pinned to /etc/ssh. Keep ssh.service running
              with password authentication and PAM enabled. Locked, expired and
              SSH-denied accounts cannot sign in.
            </Notice>
          </Card>
          <Card
            title="Linux account password"
            subtitle="Changes the password used by Debian, SSH and this console"
          >
            <Notice>
              This changes the real Debian account password. All console
              sessions are invalidated after success. Use the new password for
              both SSH and the next console login. Do not lose your recovery
              access.
            </Notice>
            <Form
              submit="Change Linux password"
              onSubmit={() =>
                act("system.linux-password", {
                  user: linuxUser,
                  password: linuxPassword,
                })
              }
            >
              <Input
                label="Linux username"
                required
                value={linuxUser}
                onChange={(event) => setLinuxUser(event.target.value)}
              />
              <Input
                label="New password"
                type="password"
                required
                minLength={8}
                value={linuxPassword}
                onChange={(event) => setLinuxPassword(event.target.value)}
              />
            </Form>
            <p className="muted">
              Create accounts, manage sudo membership and lock or delete
              accounts in the <a href="#users">User manager</a>.
            </p>
          </Card>
        </div>
      )}
      {tab === "Backups & storage" && (
        <>
          <div className="grid equal">
            <Card
              title="Configuration backup"
              subtitle="Network, VPN, firewall and selected system configuration"
            >
              <Notice danger>
                Archives contain Wi-Fi passwords and WireGuard private keys.
                Store them securely. This is not a full eMMC image. Firmware
                flashing and raw restore remain in the separate installer.
              </Notice>
              <div className="inline-actions">
                <a className="button primary" href="/api/backup">
                  <Download size={15} />
                  Download backup
                </a>
                <button onClick={() => restoreInput.current?.click()}>
                  <Upload size={15} />
                  Restore archive
                </button>
              </div>
              <input
                type="file"
                accept=".gz,.tgz"
                ref={restoreInput}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  confirm(
                    "Restore configuration",
                    "This replaces the supported configuration files from this archive. Previous files are saved with .pre-restore suffixes. Restored settings are NOT automatically activated; reload the relevant services or reboot.",
                    async () => {
                      const result = await upload("restore?confirm=yes", file);
                      notify(result.message);
                    },
                  );
                  event.target.value = "";
                }}
              />
            </Card>
            <Card
              title="Radio calibration backup"
              subtitle="Read-only downloads of your unique device partitions"
            >
              <p className="muted">
                Keep these private. They may contain your IMEI and
                device-specific radio calibration.
              </p>
              <div className="inline-actions wrap">
                {["modemst1", "modemst2", "fsg", "fsc", "persist", "sec"].map(
                  (name) => (
                    <a
                      key={name}
                      className="button"
                      href={`/api/calibration?partition=${name}`}
                    >
                      <Download size={13} />
                      {name}
                    </a>
                  ),
                )}
              </div>
              <small className="muted">
                A partition must be available under /dev/disk/by-partlabel. No
                partition writes are exposed.
              </small>
            </Card>
          </div>
          <Card title="Storage & mounts" actions={<HardDrive size={18} />}>
            <Code>{storage.data?.df}</Code>
            <h3 className="section-label">Block devices</h3>
            <Code>{JSON.stringify(storage.data?.disks, null, 2)}</Code>
          </Card>
        </>
      )}
      {tab === "Diagnostics" && (
        <div className="grid equal">
          <Card title="Network diagnostic">
            <Form
              submit="Run diagnostic"
              onSubmit={() => act("diagnostic", diagnostic)}
            >
              <Select
                label="Tool"
                options={[
                  ["ping", "Ping (4 packets)"],
                  ["dns", "DNS lookup"],
                  ["trace", "Traceroute (if installed)"],
                ]}
                value={diagnostic.type}
                onChange={(event) =>
                  setDiagnostic((old) => ({ ...old, type: event.target.value }))
                }
              />
              <Input
                label="Host or IP address"
                required
                value={diagnostic.host}
                onChange={(event) =>
                  setDiagnostic((old) => ({ ...old, host: event.target.value }))
                }
              />
            </Form>
          </Card>
          <ProcessPanel />
        </div>
      )}
      {tab === "Advanced" && (
        <>
          <Notice danger>
            These controls provide administrator-level access. Invalid settings
            can prevent boot or network access. Keep a configuration backup and
            an SSH recovery session.
          </Notice>
          <div className="grid equal">
            <Card
              title="System configuration editor"
              subtitle="Files are not automatically activated after saving"
            >
              <div className="config-links">
                {configurationFiles.map((path) => (
                  <button
                    key={path}
                    onClick={async () => {
                      try {
                        setEditing(
                          await api(`file?path=${encodeURIComponent(path)}`),
                        );
                      } catch (error) {
                        notify((error as Error).message, true);
                      }
                    }}
                  >
                    <span className="mono">{path}</span>
                  </button>
                ))}
              </div>
            </Card>
            <Card
              title="Root crontab"
              subtitle="Standard crontab syntax. Jobs execute as root."
            >
              <Form
                submit="Install crontab"
                onSubmit={() =>
                  act("system.cron", {
                    config:
                      cron ??
                      (data?.cron?.startsWith("no crontab")
                        ? ""
                        : data?.cron || ""),
                  })
                }
              >
                <Field label="Scheduled jobs">
                  <textarea
                    className="editor"
                    rows={14}
                    value={
                      cron ??
                      (data?.cron?.startsWith("no crontab")
                        ? ""
                        : data?.cron || "")
                    }
                    onChange={(event) => setCron(event.target.value)}
                    placeholder="0 4 * * * /usr/local/bin/my-task"
                  />
                </Field>
              </Form>
            </Card>
          </div>
        </>
      )}
      {editing && (
        <TextEditor
          path={editing.path}
          initial={editing.content}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ProcessPanel() {
  const { data, error, reload } = useData("processes", 10000);
  const { act } = useActions();
  const [pid, setPID] = useState(""),
    [signal, setSignal] = useState("TERM");
  return (
    <Card title="Processes & listeners" actions={<Refresh onClick={reload} />}>
      <ErrorBox error={error} />
      <Form
        submit="Send signal"
        onSubmit={() =>
          act(
            "process.signal",
            { pid, signal },
            `Send SIG${signal} to process ${pid}? Killing system processes can interrupt connectivity.`,
          )
        }
      >
        <div className="form-grid">
          <Input
            label="PID"
            type="number"
            min={2}
            required
            value={pid}
            onChange={(event) => setPID(event.target.value)}
          />
          <Select
            label="Signal"
            value={signal}
            options={["TERM", "HUP", "KILL"]}
            onChange={(event) => setSignal(event.target.value)}
          />
        </div>
      </Form>
      <Code>{data?.output}</Code>
      <h3 className="section-label">Listening sockets</h3>
      <Code>{data?.connections}</Code>
    </Card>
  );
}
