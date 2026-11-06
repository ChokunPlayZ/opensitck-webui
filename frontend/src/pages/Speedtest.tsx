import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Gauge,
  LoaderCircle,
  Timer,
} from "lucide-react";
import { bytes, useData, type Job } from "../api";
import { useJobDetails, useOperation } from "../jobs";
import {
  Badge,
  Card,
  Code,
  ErrorBox,
  KV,
  Loading,
  Notice,
  PageIntro,
  Refresh,
  useActions,
} from "../components";

interface SpeedtestData {
  status: string;
  job: string;
  error: string;
  result: {
    time: string;
    provider: string;
    latencyMS: number;
    downloadMbps: number;
    uploadMbps: number;
    downloadBytes: number;
    uploadBytes: number;
  } | null;
}

// These are completed phase measurements reported by the device, not animated
// estimates. Incomplete runs never replace the last successful result.
function measurement(output: string, name: string) {
  const match = output.match(new RegExp(`(?:^|\\n)${name}: ([\\d.]+)`));
  return match ? Number(match[1]) : undefined;
}

export default function Speedtest() {
  const { data, error, reload } = useData<SpeedtestData>("speedtest", 2000);
  const { act } = useActions();
  const operation = useOperation("speedtest.run");
  // /speedtest also identifies the active run after a browser refresh, before
  // the shared job metadata request has finished.
  const metadata: Job | undefined =
    operation.job ||
    (data?.job
      ? {
          id: data.job,
          label: "speedtest.run",
          status: data.status,
          started: "",
          output: "",
        }
      : undefined);
  const details = useJobDetails(metadata);
  const job = details.job;
  const running =
    operation.starting ||
    job?.status === "running" ||
    data?.status === "running";
  const failed =
    !running && (job?.status === "failed" || job?.status === "cancelled");
  const output = operation.starting ? "" : job?.output || "";
  const result = data?.result;
  const latency = measurement(output, "Latency");
  const download = measurement(output, "Download");
  const upload = measurement(output, "Upload");
  const stage = output.includes("Uploading…")
    ? 2
    : output.includes("Downloading…")
      ? 1
      : output.includes("Measuring HTTPS latency")
        ? 0
        : -1;
  const phaseLabels = ["Latency", "Download", "Upload"];
  const heading = running
    ? stage < 0
      ? "Waiting for the device"
      : `Measuring ${phaseLabels[stage].toLowerCase()}`
    : failed
      ? "Test could not complete"
      : job?.status === "success"
        ? "Test complete"
        : "Ready when you are";
  return (
    <>
      <PageIntro
        eyebrow="CONNECTIVITY"
        title="Speed test"
        description="Measure internet performance directly from your stick, not your browser."
      >
        <Refresh onClick={reload} />
      </PageIntro>
      <ErrorBox error={error || operation.error} />
      <Card
        title="Device internet speed"
        subtitle="Cloudflare · current default route · single HTTPS connection"
        actions={
          <Badge
            tone={
              running
                ? "amber"
                : failed
                  ? "red"
                  : job?.status === "success"
                    ? "green"
                    : "neutral"
            }
          >
            {running
              ? "Testing"
              : failed
                ? "Failed"
                : job?.status === "success"
                  ? "Completed"
                  : "On demand"}
          </Badge>
        }
      >
        {!data && !error && <Loading />}
        <div className="speedtest-control">
          <div className={`speedtest-icon ${running ? "testing" : ""}`}>
            <Gauge size={32} />
          </div>
          <div className="speedtest-copy" role="status">
            <h3>{heading}</h3>
            <p>
              {running
                ? "Live measurements appear below. You can leave this page; the test continues on your stick."
                : failed
                  ? "See the device error below. Your last successful result has not been replaced."
                  : "Check download, upload and latency without installing anything on the stick."}
            </p>
          </div>
          <button
            className="primary"
            disabled={!data || running}
            onClick={() =>
              act(
                "speedtest.run",
                {},
                "Run an internet speed test from the stick? This contacts Cloudflare and uses up to 35 MiB of payload plus protocol overhead on the current default route. Mobile data charges may apply.",
              )
            }
          >
            {running ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Gauge size={16} />
            )}
            {running ? "Test in progress…" : "Start speed test"}
          </button>
        </div>
        <ol className="test-stages" aria-label="Speed test stages">
          {phaseLabels.map((label, index) => {
            const complete = [latency, download, upload][index] !== undefined;
            const active = running && stage === index;
            return (
              <li
                key={label}
                className={complete ? "complete" : active ? "active" : ""}
                aria-current={active ? "step" : undefined}
              >
                <span>
                  {complete ? (
                    <Check size={14} />
                  ) : active ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    index + 1
                  )}
                </span>
                {label}
                <small>
                  {complete
                    ? "Measured"
                    : active
                      ? "Measuring…"
                      : failed
                        ? "Not completed"
                        : "Pending"}
                </small>
              </li>
            );
          })}
        </ol>
        <div className="speedtest-data-note">
          Up to 35 MiB per test, plus protocol overhead. May use mobile data.
          Runs only after confirmation.
        </div>
      </Card>
      <ErrorBox
        error={
          details.error
            ? `Cannot read live test output: ${details.error}. The test may still be running.`
            : ""
        }
      />
      {failed && (
        <Notice danger>
          {data?.error || "The latest test did not complete."}
        </Notice>
      )}
      <div className="result-caption">
        <span>
          {running
            ? "CURRENT TEST · COMPLETED PHASES"
            : "LAST SUCCESSFUL RESULT"}
        </span>
        <small>
          {running
            ? "Updates after each phase"
            : result
              ? new Date(result.time).toLocaleString()
              : "Run a test to see your connection performance"}
        </small>
      </div>
      <div className="metrics-grid speedtest-metrics">
        {[
          {
            label: "Download",
            value: running ? download : result?.downloadMbps,
            unit: "Mbps",
            detail: "Single HTTPS connection",
            icon: ArrowDownLeft,
          },
          {
            label: "Upload",
            value: running ? upload : result?.uploadMbps,
            unit: "Mbps",
            detail: "Streamed from the stick",
            icon: ArrowUpRight,
          },
          {
            label: "Latency",
            value: running ? latency : result?.latencyMS,
            unit: "ms",
            detail: "Mean of 3 HTTPS round trips",
            icon: Timer,
          },
          {
            label: "Payload transferred",
            value:
              !running && result
                ? bytes(result.downloadBytes + result.uploadBytes)
                : undefined,
            unit: "",
            detail: running
              ? "Total available after completion"
              : "Excludes protocol overhead",
            icon: Gauge,
          },
        ].map((metric) => (
          <div
            className={`metric-card ${running && metric.value !== undefined ? "measured" : ""}`}
            key={metric.label}
          >
            <div className="metric-label">
              {metric.label}
              <metric.icon size={16} />
            </div>
            <strong>
              {typeof metric.value === "number"
                ? metric.value.toFixed(metric.unit === "ms" ? 1 : 2)
                : metric.value || "—"}{" "}
              <span className="metric-unit">
                {metric.value !== undefined && metric.unit}
              </span>
            </strong>
            <p>{metric.detail}</p>
          </div>
        ))}
      </div>
      {job && (
        <details className="test-output" open={failed || undefined}>
          <summary>
            {failed ? "Device error and test output" : "Device test output"}
          </summary>
          <Code>
            {output ||
              "Waiting for the device… The test may be queued behind another operation."}
          </Code>
        </details>
      )}
      <Card title={running ? "Previous successful result" : "Test details"}>
        <KV
          rows={[
            [
              "Completed",
              result
                ? new Date(result.time).toLocaleString()
                : "No test completed yet",
            ],
            ...(running && result
              ? [
                  [
                    "Previous speeds",
                    `${result.downloadMbps.toFixed(2)} Mbps down · ${result.uploadMbps.toFixed(2)} Mbps up · ${result.latencyMS.toFixed(1)} ms`,
                  ] as [string, string],
                ]
              : []),
            [
              "Provider",
              result?.provider || "Cloudflare · speed.cloudflare.com",
            ],
            [
              "Route",
              "Current system default (Wi-Fi, cellular, Ethernet or VPN)",
            ],
            [
              "Method",
              "Fixed-size, single-connection HTTPS download and upload",
            ],
          ]}
        />
        <p className="muted">
          These are practical estimates, not an Ookla test or a carrier
          line-speed guarantee. Latency includes TLS setup on the first request.
          Failed tests keep the previous successful result. Results are kept
          until the console service restarts.
        </p>
      </Card>
    </>
  );
}
