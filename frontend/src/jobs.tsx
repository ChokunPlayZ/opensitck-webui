import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  LoaderCircle,
  X,
} from "lucide-react";
import { api, useData, type Job } from "./api";

export const OperationScope = createContext("overview");

interface ActionResult {
  job?: string;
  message?: string;
}
interface JobsContextValue {
  jobs: Job[];
  error: string;
  scopes: Record<string, string>;
  starting: string[];
  actionErrors: Record<string, string>;
  run: (
    action: string,
    params: Record<string, string>,
    scope: string,
  ) => Promise<ActionResult>;
}
const JobsContext = createContext<JobsContextValue>(null!);
export const useJobs = () => useContext(JobsContext);

export function JobProvider({ children }: { children: ReactNode }) {
  // Poll lightweight metadata even when Activity is closed. Logs are fetched only
  // for operations being viewed, never all forty bounded output buffers.
  const { data, error, reload } = useData<Job[]>("jobs?selected=none", 2500);
  const [optimistic, setOptimistic] = useState<Job[]>([]);
  const [scopes, setScopes] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState<string[]>([]);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const pending = useRef(new Set<string>());
  const statuses = useRef(new Map<string, string>());
  const jobs = [
    ...(data || []),
    ...optimistic.filter((job) => !data?.some((item) => item.id === job.id)),
  ].sort((a, b) => Date.parse(b.started) - Date.parse(a.started));

  useEffect(() => {
    if (!data) return;
    let completed = false;
    for (const job of data) {
      if (
        statuses.current.get(job.id) === "running" &&
        job.status !== "running"
      )
        completed = true;
      statuses.current.set(job.id, job.status);
    }
    setOptimistic((current) =>
      current.filter((job) => !data.some((item) => item.id === job.id)),
    );
    if (completed) window.dispatchEvent(new Event("configuration-changed"));
  }, [data]);

  async function run(
    action: string,
    params: Record<string, string>,
    scope: string,
  ) {
    if (pending.current.has(action))
      throw new Error("This operation is already starting. Please wait.");
    pending.current.add(action);
    setStarting([...pending.current]);
    setActionErrors((current) => ({ ...current, [action]: "" }));
    try {
      const result = await api<ActionResult>("action", {
        action,
        params,
        confirm: true,
      });
      if (result.job) {
        const job: Job = {
          id: result.job,
          label: action,
          started: new Date().toISOString(),
          status: "running",
          output: "",
        };
        statuses.current.set(job.id, "running");
        setOptimistic((current) => [job, ...current]);
        setScopes((current) => ({ ...current, [job.id]: scope }));
        reload();
      } else {
        window.dispatchEvent(new Event("configuration-changed"));
      }
      return result;
    } catch (error) {
      setActionErrors((current) => ({
        ...current,
        [action]: (error as Error).message,
      }));
      throw error;
    } finally {
      pending.current.delete(action);
      setStarting([...pending.current]);
    }
  }

  return (
    <JobsContext.Provider
      value={{ jobs, error, scopes, starting, actionErrors, run }}
    >
      {children}
    </JobsContext.Provider>
  );
}

export function useOperation(action: string) {
  const { jobs, starting, actionErrors } = useJobs();
  const job = jobs.find((item) => item.label === action);
  return {
    job,
    starting: starting.includes(action),
    error: actionErrors[action] || "",
    running: job?.status === "running" || starting.includes(action),
  };
}

export function useJobDetails(job?: Job) {
  const { data, error } = useData<Job[]>(
    job ? `jobs?selected=${encodeURIComponent(job.id)}` : null,
    job?.status === "running" ? 1500 : 0,
  );
  const details = data?.find((item) => item.id === job?.id);
  return {
    job: job && {
      ...job,
      ...details,
      status:
        job.status === "running" ? details?.status || job.status : job.status,
    },
    error,
  };
}

const titles: Record<string, string> = {
  "wifi.scan": "Wi-Fi scan",
  "wifi.connect": "Wi-Fi connection",
  "wifi.hotspot": "Access point",
  "wifi.radio": "Wi-Fi radio",
  "speedtest.run": "Speed test",
  "package.update": "APT index refresh",
  "package.upgrade": "System upgrade",
  "package.install": "Package installation",
  "package.remove": "Package removal",
  diagnostic: "Network diagnostic",
};
export const jobTitle = (label: string) =>
  titles[label] || label.replaceAll(".", " · ").replaceAll("-", " ");
export const jobStatus = (job: Job) =>
  job.status === "running"
    ? "In progress"
    : job.status === "success"
      ? "Completed"
      : job.status === "cancelled"
        ? "Cancelled"
        : "Failed";

function defaultScope(label: string) {
  const prefix = label.split(".")[0];
  if (["modem", "sim", "sms"].includes(prefix)) return "cellular";
  if (["profile", "route", "forwarding"].includes(prefix)) return "network";
  return (
    (
      {
        package: "packages",
        service: "services",
        user: "users",
        file: "files",
        diagnostic: "system",
        process: "system",
      } as Record<string, string>
    )[prefix] || prefix
  );
}

export function PageOperations() {
  const scope = useContext(OperationScope);
  const { jobs, scopes, error } = useJobs();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const relevant = jobs.filter(
    (job) =>
      (scopes[job.id] || defaultScope(job.label)) === scope &&
      !["wifi.scan", "speedtest.run"].includes(job.label) &&
      !dismissed.includes(job.id),
  );
  const visible = [
    ...relevant.filter((job) => job.status === "running"),
    ...relevant.filter((job) => job.status !== "running").slice(0, 1),
  ];
  return (
    <>
      {error && (
        <div className="notice danger" role="status">
          <AlertTriangle size={17} />
          <span>
            Cannot update operation status: {error}. Operations may still be
            running on the stick.
          </span>
        </div>
      )}
      {visible.length > 0 && (
        <div className="page-operations" aria-label="Page operations">
          {visible.map((job) => (
            <JobStatus
              key={job.id}
              job={job}
              showOutput={
                job.label === "diagnostic" || job.label.startsWith("package.")
              }
              onDismiss={() => setDismissed((current) => [...current, job.id])}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function JobStatus({
  job,
  title,
  description,
  showOutput = false,
  onDismiss,
}: {
  job: Job;
  title?: string;
  description?: string;
  showOutput?: boolean;
  onDismiss?: () => void;
}) {
  const failed = !["running", "success"].includes(job.status);
  const [expanded, setExpanded] = useState(showOutput || failed);
  useEffect(() => {
    if (failed) setExpanded(true);
  }, [failed]);
  return (
    <section
      className={`operation-status ${job.status}`}
      aria-label={title || jobTitle(job.label)}
    >
      <div className="operation-summary">
        <span className="operation-icon">
          {job.status === "running" ? (
            <LoaderCircle size={18} className="spin" />
          ) : failed ? (
            <AlertTriangle size={18} />
          ) : (
            <CheckCircle2 size={18} />
          )}
        </span>
        <div className="operation-copy" role="status">
          <strong>
            {title || jobTitle(job.label)}{" "}
            <span className="operation-state">{jobStatus(job)}</span>
          </strong>
          <p>
            {description ||
              (job.status === "running"
                ? "Running on your stick. You can keep using the console."
                : `Finished ${new Date(job.finished || job.started).toLocaleTimeString()}`)}
          </p>
        </div>
        <button
          className="text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Hide output" : "View output"}
          <ChevronDown size={14} />
        </button>
        {onDismiss && job.status !== "running" && (
          <button
            className="icon-button"
            aria-label="Dismiss operation"
            onClick={onDismiss}
          >
            <X size={15} />
          </button>
        )}
      </div>
      {expanded && <JobOutput job={job} />}
    </section>
  );
}

function JobOutput({ job }: { job: Job }) {
  const details = useJobDetails(job);
  return (
    <div className="operation-output">
      {details.error && (
        <p className="danger-text" role="status">
          Cannot read live output: {details.error}. The operation may still be
          running.
        </p>
      )}
      <pre className="code">
        {details.job?.output ||
          (job.status === "running"
            ? "Waiting for the device… This operation may be queued behind another task."
            : "No output recorded.")}
      </pre>
    </div>
  );
}
