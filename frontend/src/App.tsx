import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import {
  Activity,
  ArrowRight,
  BatteryCharging,
  ChevronDown,
  CircuitBoard,
  EthernetPort,
  FileCode2,
  Gauge,
  Globe2,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Package,
  Radio,
  ScrollText,
  ServerCog,
  Settings2,
  Shield,
  TerminalSquare,
  Usb,
  Users as UsersIcon,
  Wifi,
  X,
} from "lucide-react";
import { api, setCSRF, useData, type Job } from "./api";
import { JobProvider, OperationScope, useJobs } from "./jobs";
import {
  ActionProvider,
  Badge,
  Code,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  useActions,
} from "./components";
import Overview from "./pages/Overview";
import Cellular from "./pages/Cellular";
import WifiPage from "./pages/Wifi";
import Network from "./pages/Network";
import Wireguard from "./pages/Wireguard";
import Firewall from "./pages/Firewall";
import Services from "./pages/Services";
import Logs from "./pages/Logs";
import Files from "./pages/Files";
import Packages from "./pages/Packages";
const Terminal = lazy(() => import("./pages/Terminal"));
import System from "./pages/System";
import Speedtest from "./pages/Speedtest";
import Users from "./pages/Users";
import BatteryDisplay from "./pages/BatteryDisplay";

const navigation = [
  {
    group: "WORKSPACE",
    items: [{ id: "overview", label: "Overview", icon: LayoutDashboard }],
  },
  {
    group: "CONNECTIVITY",
    items: [
      { id: "cellular", label: "Cellular & SIM", icon: Radio },
      { id: "wifi", label: "Wi-Fi", icon: Wifi },
      { id: "network", label: "Network", icon: EthernetPort },
      { id: "speedtest", label: "Speed test", icon: Gauge },
      { id: "wireguard", label: "WireGuard", icon: Globe2 },
      { id: "firewall", label: "Firewall", icon: Shield },
    ],
  },
  {
    group: "DEVICE",
    items: [
      { id: "hardware", label: "Battery & display", icon: BatteryCharging },
      { id: "services", label: "Services", icon: ServerCog },
      { id: "logs", label: "Logs", icon: ScrollText },
      { id: "files", label: "Files & config", icon: FileCode2 },
      { id: "packages", label: "Packages", icon: Package },
      { id: "users", label: "User manager", icon: UsersIcon },
      { id: "terminal", label: "Web terminal", icon: TerminalSquare },
      { id: "system", label: "System", icon: Settings2 },
    ],
  },
];
const pages: Record<string, ComponentType> = {
  hardware: BatteryDisplay,
  cellular: Cellular,
  wifi: WifiPage,
  network: Network,
  speedtest: Speedtest,
  wireguard: Wireguard,
  firewall: Firewall,
  services: Services,
  logs: Logs,
  files: Files,
  packages: Packages,
  system: System,
  users: Users,
};

function Login({ onLogin }: { onLogin: (username: string) => void }) {
  const [username, setUsername] = useState("user"),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <div className="login-decoration" />
      <form
        className="login-card"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const result = await api("login", { username, password });
            setCSRF(result.csrf);
            onLogin(result.username);
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Brand />
        <div className="eyebrow">DEVICE MANAGEMENT, REIMAGINED</div>
        <h1>
          Your stick.
          <br />
          <span>Your control.</span>
        </h1>
        <p className="muted">
          Sign in with your existing Debian username and password.
        </p>
        <ErrorBox error={error} />
        <Input
          label="Username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <button className="primary login-submit" disabled={busy}>
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <>
              Open console
              <ArrowRight size={17} />
            </>
          )}
        </button>
        <div className="login-foot">
          <Shield size={13} />
          Debian SSH / PAM authentication · No separate password
        </div>
      </form>
      <div className="login-bottom">
        OPENSTICK CONSOLE <span>SMALL DEVICE. OPEN POSSIBILITIES.</span>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Usb size={22} />
      </span>
      <div>
        openstick<span>DEVICE CONSOLE</span>
      </div>
    </div>
  );
}

export default function App() {
  const [username, setUsername] = useState("user");
  const [authenticated, setAuthenticated] = useState<boolean | null>(null),
    [jobsOpen, setJobsOpen] = useState(false);
  useEffect(() => {
    api("session")
      .then((session) => {
        setCSRF(session.csrf);
        setUsername(session.username || "user");
        setAuthenticated(session.authenticated);
      })
      .catch(() => setAuthenticated(false));
    const expire = () => {
      setAuthenticated(false);
      setCSRF("");
    };
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
  if (authenticated === null)
    return (
      <div className="boot-loading">
        <Loading />
      </div>
    );
  if (!authenticated)
    return (
      <Login
        onLogin={(name) => {
          setUsername(name);
          setAuthenticated(true);
        }}
      />
    );
  return (
    <JobProvider>
      <ActionProvider onOpenJobs={() => setJobsOpen(true)}>
        <Console
          username={username}
          onLogout={() => setAuthenticated(false)}
          onJobs={() => setJobsOpen(true)}
        />
        {jobsOpen && <Jobs onClose={() => setJobsOpen(false)} />}
      </ActionProvider>
    </JobProvider>
  );
}

function Console({
  username,
  onLogout,
  onJobs,
}: {
  username: string;
  onLogout: () => void;
  onJobs: () => void;
}) {
  const [page, setPage] = useState(location.hash.slice(1) || "overview"),
    [mobileOpen, setMobileOpen] = useState(false);
  const status = useData("status", 15000);
  const { notify } = useActions();
  const { jobs } = useJobs();
  const runningJobs = jobs.filter((job) => job.status === "running").length;
  function navigate(target: string) {
    setPage(target);
    location.hash = target;
    setMobileOpen(false);
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    const handler = () => setPage(location.hash.slice(1) || "overview");
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  const title =
      navigation
        .flatMap((group) => group.items)
        .find((item) => item.id === page)?.label || "Overview",
    Page = pages[page];
  return (
    <div className="app-shell">
      {mobileOpen && (
        <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />
      )}
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <Brand />
        <div className="device-picker">
          <span className="device-picker-icon">
            <CircuitBoard size={21} />
          </span>
          <span>
            <strong>{status.data?.system?.hostname || "OpenStick"}</strong>
            <small>
              <span className="live-dot" />
              Connected device
            </small>
          </span>
          <ChevronDown size={14} />
        </div>
        <nav>
          {navigation.map((group) => (
            <div className="nav-group" key={group.group}>
              <div className="nav-label">{group.group}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={page === item.id ? "active" : ""}
                  onClick={() => navigate(item.id)}
                >
                  <item.icon size={17} />
                  <span>{item.label}</span>
                  {item.id === "terminal" && (
                    <span className="nav-shortcut" aria-hidden="true">
                      &gt;_
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="live-dot" />
            <span>
              Runs on your stick<small>No cloud. No dependencies.</small>
            </span>
          </div>
          <button
            className="logout-button"
            onClick={async () => {
              try {
                await api("logout", {});
                onLogout();
              } catch (error) {
                notify((error as Error).message, true);
              }
            }}
          >
            <LogOut size={16} />
            <span>Sign out</span>
            <small>{username}</small>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span>Device</span>
            <span className="slash">/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            {status.error ? (
              <Badge tone="red">Device unreachable</Badge>
            ) : (
              <span className="topbar-status">
                <span className="live-dot" />
                System online
              </span>
            )}
            <button className="activity-button" onClick={onJobs}>
              {runningJobs ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Activity size={16} />
              )}
              <span>Activity</span>
              {runningJobs > 0 && (
                <span className="activity-count">{runningJobs}</span>
              )}
            </button>
            <span className="avatar">{username[0]?.toUpperCase()}</span>
          </div>
        </header>
        <main>
          <OperationScope.Provider key={page} value={page}>
            <Suspense fallback={<Loading />}>
              {page === "terminal" ? (
                <Terminal username={username} />
              ) : Page ? (
                <Page />
              ) : (
                <Overview navigate={navigate} />
              )}
            </Suspense>
          </OperationScope.Provider>
          <footer>
            <span>
              OpenStick Console <span className="muted">/</span> v1.0.0
            </span>
            <span>
              <span className="live-dot" />
              Built for the little things that do more.
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Jobs({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState("");
  const { data, error } = useData<Job[]>(
    `jobs?selected=${encodeURIComponent(selected)}`,
    1500,
  );
  const current = data?.find((job) => job.id === selected) || data?.[0];
  return (
    <Modal wide title="Device activity" onClose={onClose}>
      <ErrorBox error={error} />
      <p className="muted">
        Operations continue on the stick when you close this window. Last 40
        operations are kept until service restart.
      </p>
      <div className="jobs-layout">
        <div className="jobs-list">
          {data?.length ? (
            data.map((job) => (
              <button
                className={current?.id === job.id ? "selected" : ""}
                key={job.id}
                onClick={() => setSelected(job.id)}
              >
                <span>{job.label}</span>
                <Badge
                  tone={
                    job.status === "success"
                      ? "green"
                      : job.status === "running"
                        ? "amber"
                        : "red"
                  }
                >
                  {job.status}
                </Badge>
                <small>{new Date(job.started).toLocaleTimeString()}</small>
              </button>
            ))
          ) : (
            <p className="muted">No operations yet.</p>
          )}
        </div>
        <Code>{current?.output || "Waiting for output…"}</Code>
      </div>
    </Modal>
  );
}
