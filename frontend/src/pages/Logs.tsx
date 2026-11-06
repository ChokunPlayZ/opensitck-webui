import { useState } from "react";
import { useData } from "../api";
import {
  Card,
  Code,
  ErrorBox,
  Input,
  PageIntro,
  Refresh,
  Select,
  Tabs,
} from "../components";

export default function Logs() {
  const [tab, setTab] = useState("System journal"),
    [unit, setUnit] = useState(""),
    [priority, setPriority] = useState(""),
    [search, setSearch] = useState(""),
    [live, setLive] = useState(true);
  const path =
    tab === "Console audit"
      ? "audit"
      : `logs?lines=500&unit=${encodeURIComponent(unit)}&priority=${priority}&kernel=${tab === "Kernel" ? "1" : "0"}`;
  const { data, error, reload } = useData(path, live ? 5000 : 0);
  const output = (data?.output || "")
    .split("\n")
    .filter((line: string) => line.toLowerCase().includes(search.toLowerCase()))
    .join("\n");
  return (
    <>
      <PageIntro
        eyebrow="OBSERVABILITY"
        title="Logs"
        description="System journal, kernel events and console audit trail."
      >
        <button
          className={live ? "primary" : ""}
          onClick={() => setLive(!live)}
        >
          {live ? "Live · 5s" : "Paused"}
        </button>
        <Refresh onClick={reload} />
      </PageIntro>
      <Tabs
        value={tab}
        onChange={setTab}
        items={["System journal", "Kernel", "Console audit"]}
      />
      <ErrorBox error={error} />
      <Card>
        <div className="form-grid three">
          <Input
            label="Filter text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search visible output…"
          />
          {tab === "System journal" && (
            <Input
              label="Service (optional)"
              placeholder="ModemManager.service"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
            />
          )}{" "}
          {tab !== "Console audit" && (
            <Select
              label="Minimum severity"
              value={priority}
              options={[
                ["", "All"],
                ["3", "Error"],
                ["4", "Warning"],
                ["6", "Info"],
              ]}
              onChange={(event) => setPriority(event.target.value)}
            />
          )}
        </div>
        <ErrorBox error={data?.error} />
        <Code>{output || "No matching entries."}</Code>
      </Card>
    </>
  );
}
