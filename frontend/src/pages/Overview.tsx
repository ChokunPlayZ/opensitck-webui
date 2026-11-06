import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  CircuitBoard,
  Cpu,
  EthernetPort,
  HardDrive,
  MemoryStick,
  Radio,
  Thermometer,
  Wifi,
  Zap,
} from "lucide-react";
import { bytes, duration, useData, type Sample } from "../api";
import {
  Badge,
  Card,
  ErrorBox,
  KV,
  Loading,
  PageIntro,
  Refresh,
} from "../components";

function Sparkline({
  samples,
  field,
  color = "#a7f3ce",
  height = 80,
}: {
  samples: Sample[];
  field: keyof Sample;
  color?: string;
  height?: number;
}) {
  const values = samples.map((sample) => sample[field]);
  if (values.length < 2)
    return <div className="chart-wait">Collecting live samples…</div>;
  const max = Math.max(...values, 1) * 1.15;
  const points = values
    .map(
      (value, index) =>
        `${(index / (values.length - 1)) * 600},${height - (value / max) * (height - 10)}`,
    )
    .join(" ");
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 600 ${height}`}
      preserveAspectRatio="none"
      aria-label={`${field} history`}
    >
      <path
        d={`M 0 ${height} L ${points.replaceAll(" ", " L ")} L 600 ${height} Z`}
        fill={color}
        opacity=".07"
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function Overview({
  navigate,
}: {
  navigate: (page: string) => void;
}) {
  const { data, error, reload } = useData("status", 5000);
  const network = useData("network", 20000);
  const modem = useData("modem", 30000);
  if (!data?.system)
    return (
      <>
        <ErrorBox error={error} />
        <Loading />
      </>
    );
  const system = data.system,
    sample: Sample = system.sample,
    history: Sample[] = data.history || [];
  const disk = system.disk,
    diskUsed = 100 * (1 - disk.free / disk.total);
  const defaultRoute = network.data?.routes?.find(
    (route: any) => route.dst === "default",
  );
  const firstModem = modem.data?.modems?.[0]?.data?.modem?.generic;
  const activeWifi = network.data?.wifi?.find(
    (row: string[]) => row[0] === "*",
  );
  const usb = network.data?.interfaces?.find(
    (iface: any) => iface.ifname === "usb0",
  );
  return (
    <>
      <PageIntro
        eyebrow="YOUR DEVICE, AT A GLANCE"
        title="Overview"
        description="A little device. A lot of possibilities."
      >
        <Badge tone="green">Live telemetry</Badge>
        <Refresh
          onClick={() => {
            reload();
            network.reload();
            modem.reload();
          }}
        />
      </PageIntro>
      <ErrorBox error={error} />
      <ErrorBox error={network.error} />
      <ErrorBox error={modem.error} />
      <section className="hero-card">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="live-dot" /> OPENSTICK CONSOLE
          </div>
          <h2>
            Small form.
            <br />
            <span>Full control.</span>
          </h2>
          <p>
            {system.model || "OpenStick Linux device"} · {system.hostname}
          </p>
          <div className="hero-tags">
            <span>Debian 13</span>
            <span>ARM64</span>
            <span>Kernel {system.kernel?.split("-")[0]}</span>
          </div>
        </div>
        <div className="device-visual">
          <div className="device-glow" />
          <div className="usb-stick">
            <div className="usb-connector">
              <i />
              <i />
            </div>
            <div className="stick-body">
              <span className="stick-brand">
                openstick<span>LINUX. UNPLUGGED.</span>
              </span>
              <div className="stick-led" />
              <div className="stick-lines">
                <i />
                <i />
                <i />
              </div>
            </div>
          </div>
          <div className="device-caption">
            <span className="live-dot" /> SYSTEM ONLINE
          </div>
        </div>
        <div className="hero-summary">
          <div>
            <Activity size={17} />
            <span>
              UPTIME<strong>{duration(system.uptime)}</strong>
            </span>
          </div>
          <div>
            <Thermometer size={17} />
            <span>
              THERMALS
              <strong>
                {sample.temperature
                  ? `${sample.temperature.toFixed(0)}°C`
                  : "Not reported"}
              </strong>
            </span>
          </div>
          <div>
            <CircuitBoard size={17} />
            <span>
              FIRMWARE<strong>Console v{system.version}</strong>
            </span>
          </div>
        </div>
      </section>
      <div className="metrics-grid">
        {[
          {
            title: "CPU usage",
            value: `${sample.cpu.toFixed(1)}%`,
            detail: "Quad-core Snapdragon 410",
            icon: Cpu,
            field: "cpu" as const,
            color: "#a7f3ce",
          },
          {
            title: "Memory",
            value: `${sample.memory.toFixed(0)}%`,
            detail: `${bytes(system.memory.MemTotal - system.memory.MemAvailable)} / ${bytes(system.memory.MemTotal)}`,
            icon: MemoryStick,
            field: "memory" as const,
            color: "#b8acff",
          },
          {
            title: "Storage",
            value: `${diskUsed.toFixed(0)}%`,
            detail: `${bytes(disk.available)} available`,
            icon: HardDrive,
            field: null,
            color: "#ffc994",
          },
          {
            title: "Downlink",
            value: `${bytes(sample.rx)}/s`,
            detail: "Wi-Fi + cellular · not USB",
            icon: ArrowDownLeft,
            field: "rx" as const,
            color: "#92c5ff",
          },
        ].map((metric) => (
          <div className="metric-card" key={metric.title}>
            <div className="metric-label">
              {metric.title}
              <metric.icon size={16} />
            </div>
            <strong>{metric.value}</strong>
            <p>{metric.detail}</p>
            {metric.field ? (
              <Sparkline
                samples={history}
                field={metric.field}
                color={metric.color}
                height={44}
              />
            ) : (
              <div className="storage-gauge">
                <div
                  style={{ width: `${diskUsed}%`, background: metric.color }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="grid two-one">
        <Card
          title="Network activity"
          subtitle="Live throughput across uplink interfaces · last 10 minutes"
          actions={
            <span className="live-label">
              <span className="live-dot" /> 5s refresh
            </span>
          }
        >
          <div className="traffic-values">
            <span>
              <ArrowDownLeft size={16} /> Download{" "}
              <strong>{bytes(sample.rx)}/s</strong>
            </span>
            <span>
              <ArrowUpRight size={16} /> Upload{" "}
              <strong>{bytes(sample.tx)}/s</strong>
            </span>
          </div>
          <div className="traffic-chart">
            <div className="chart-grid">
              <i />
              <i />
              <i />
            </div>
            <Sparkline samples={history} field="rx" height={150} />
            <Sparkline
              samples={history}
              field="tx"
              color="#a99bfa"
              height={150}
            />
          </div>
          <div className="chart-axis">
            <span>10 minutes ago</span>
            <span>Now</span>
          </div>
        </Card>
        <Card title="Connection health" subtitle="Real status. No guesswork.">
          <div className="connection-list">
            <button onClick={() => navigate("wifi")}>
              <span className="connection-icon">
                <Wifi size={20} />
              </span>
              <span>
                <strong>Wi-Fi uplink</strong>
                <small>
                  {network.loading
                    ? "Checking connection…"
                    : activeWifi?.[1] || "Not connected"}
                </small>
              </span>
              <Badge tone={activeWifi ? "green" : "neutral"}>
                {network.loading
                  ? "Checking"
                  : activeWifi
                    ? `${activeWifi[2]}%`
                    : "Idle"}
              </Badge>
            </button>
            <button onClick={() => navigate("cellular")}>
              <span className="connection-icon purple">
                <Radio size={20} />
              </span>
              <span>
                <strong>Cellular modem</strong>
                <small>
                  {firstModem?.["state-failed-reason"] === "sim-missing"
                    ? "Insert a SIM to get started"
                    : firstModem?.state || "Checking modem…"}
                </small>
              </span>
              <Badge
                tone={firstModem?.state === "connected" ? "green" : "amber"}
              >
                {modem.loading
                  ? "Checking"
                  : firstModem?.state === "connected"
                    ? "Online"
                    : "Offline"}
              </Badge>
            </button>
            <button onClick={() => navigate("network")}>
              <span className="connection-icon blue">
                <EthernetPort size={20} />
              </span>
              <span>
                <strong>USB management</strong>
                <small>
                  {network.loading
                    ? "Checking interface…"
                    : usb?.addr_info?.find(
                        (addr: any) => addr.family === "inet",
                      )?.local || "No address"}
                </small>
              </span>
              <Badge tone={usb?.operstate === "UP" ? "green" : "neutral"}>
                {network.loading
                  ? "Checking"
                  : usb?.operstate === "UP"
                    ? "Local"
                    : "Down"}
              </Badge>
            </button>
          </div>
          <div className="gateway-note">
            <Zap size={14} /> Default uplink{" "}
            <strong>
              {network.loading ? "Checking…" : defaultRoute?.dev || "None"}
            </strong>
          </div>
        </Card>
      </div>
      <div className="grid equal">
        <Card title="System information">
          <KV
            rows={[
              ["Board", system.model],
              ["Hostname", system.hostname],
              ["Kernel", system.kernel],
              ["System time", new Date(system.time).toLocaleString()],
            ]}
          />
        </Card>
        <Card
          title="Quick access"
          subtitle="Your most-used tools, one click away"
        >
          <div className="quick-links">
            {[
              ["terminal", "Web terminal", "A login shell as your Debian user"],
              ["cellular", "Mobile broadband", "SIM, APN and radio settings"],
              ["wireguard", "WireGuard VPN", "Private tunnels and peers"],
              ["system", "System settings", "Backups, time and security"],
            ].map(([page, title, detail]) => (
              <button key={page} onClick={() => navigate(page)}>
                <span>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
