import { useState } from "react";
import { Search } from "lucide-react";
import { useData } from "../api";
import {
  Badge,
  Card,
  Code,
  ErrorBox,
  Loading,
  Modal,
  PageIntro,
  Refresh,
  useActions,
} from "../components";

export default function Services() {
  const { data, error, reload } = useData("services", 10000);
  const { act } = useActions();
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [logUnit, setLogUnit] = useState("");
  const logs = useData(
    `logs?unit=${encodeURIComponent(logUnit || "openstick-webui.service")}`,
    logUnit ? 5000 : 0,
  );
  const enabled = new Map<string, string>(
    (data?.unitFiles || "")
      .split("\n")
      .map((line: string) => line.trim().split(/\s+/))
      .filter((parts: string[]) => parts.length >= 2)
      .map((parts: string[]) => [parts[0], parts[1]]),
  );
  const units =
    data?.units?.filter(
      (unit: any) =>
        `${unit.name} ${unit.description}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (filter === "all" || unit.active === filter),
    ) || [];
  return (
    <>
      <PageIntro
        eyebrow="SYSTEM CONTROL"
        title="Services"
        description="Start, stop and configure every systemd service."
      >
        <Refresh onClick={reload} />
      </PageIntro>
      <ErrorBox error={error} />
      <Card title="System services" subtitle={`${units.length} services`}>
        <div className="filter-bar">
          <div className="search-input">
            <Search size={16} />
            <input
              aria-label="Search services"
              placeholder="Search services…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            aria-label="Filter service state"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All states</option>
            <option value="active">Active</option>
            <option value="failed">Failed</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        {!data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>State</th>
                  <th>Startup</th>
                  <th>Control</th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit: any) => (
                  <tr key={unit.name}>
                    <td>
                      <strong>{unit.name}</strong>
                      <small>{unit.description}</small>
                    </td>
                    <td>
                      <Badge
                        tone={
                          unit.active === "active"
                            ? "green"
                            : unit.active === "failed"
                              ? "red"
                              : "neutral"
                        }
                      >
                        {unit.active}
                      </Badge>
                    </td>
                    <td>{enabled.get(unit.name) || "—"}</td>
                    <td>
                      <div className="inline-actions">
                        <button onClick={() => setLogUnit(unit.name)}>
                          Logs
                        </button>
                        <select
                          aria-label={`Action for ${unit.name}`}
                          value=""
                          onChange={(event) => {
                            if (event.target.value)
                              act(
                                "service",
                                { unit: unit.name, verb: event.target.value },
                                `${event.target.value} ${unit.name}? Changes to networking, SSH, DNS or this console can interrupt connectivity.`,
                              );
                          }}
                        >
                          <option value="">Manage…</option>
                          {[
                            "start",
                            "stop",
                            "restart",
                            "enable",
                            "disable",
                            "unmask",
                            "mask",
                            "reset-failed",
                          ].map((verb) => (
                            <option key={verb} value={verb}>
                              {verb}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {logUnit && (
        <Modal
          wide
          title={`${logUnit} · journal`}
          onClose={() => setLogUnit("")}
        >
          <ErrorBox error={logs.error} />
          <Code>{logs.data?.output}</Code>
        </Modal>
      )}
    </>
  );
}
