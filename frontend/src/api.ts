import { useCallback, useEffect, useState } from "react";

let csrfToken = "";
export function setCSRF(token: string) {
  csrfToken = token;
}

export async function api<T = any>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "login")
      window.dispatchEvent(new Event("session-expired"));
    throw new Error(result.error || `Request failed (${response.status})`);
  }
  return result;
}

export async function upload(path: string, file: File) {
  const response = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
    body: file,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Upload failed");
  return result;
}

export function terminalURL() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal?csrf=${encodeURIComponent(csrfToken)}`;
}

// Poll only the page that is mounted. Failed requests retain the last good value
// and show an error instead of inventing data or replacing it with zeros.
export function useData<T = any>(path: string | null, interval = 0) {
  const empty = { path, data: null as T | null, error: "", loading: true };
  const [resource, setResource] = useState(empty);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!path || path.startsWith("jobs")) return;
    window.addEventListener("configuration-changed", reload);
    return () => window.removeEventListener("configuration-changed", reload);
  }, [path, reload]);
  useEffect(() => {
    if (!path) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setResource((current) =>
      current.path === path
        ? current
        : { path, data: null, error: "", loading: true },
    );
    const load = async () => {
      try {
        const value = await api<T>(path);
        if (active) {
          setResource({ path, data: value, error: "", loading: false });
        }
      } catch (error) {
        if (active)
          setResource((current) => ({
            ...current,
            path,
            error: (error as Error).message,
            loading: false,
          }));
      } finally {
        if (active) {
          if (interval) timer = setTimeout(load, interval);
        }
      }
    };
    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [path, interval, revision]);
  // Never expose the old directory/profile's data under a new resource path.
  return { ...(resource.path === path ? resource : empty), reload };
}

export const bytes = (value = 0) => {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][unit]}`;
};
export const duration = (seconds = 0) => {
  const days = Math.floor(seconds / 86400),
    hours = Math.floor((seconds % 86400) / 3600),
    minutes = Math.floor((seconds % 3600) / 60);
  return `${days ? `${days}d ` : ""}${hours}h ${minutes}m`;
};
export const encode = encodeURIComponent;

export interface Profile {
  name: string;
  uuid: string;
  type: string;
  device: string;
  autoconnect: string;
}
export interface Sample {
  time: number;
  cpu: number;
  memory: number;
  rx: number;
  tx: number;
  temperature: number;
}
export interface Job {
  id: string;
  label: string;
  started: string;
  finished?: string;
  status: string;
  output: string;
}
