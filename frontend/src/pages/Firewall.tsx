import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useData } from "../api";
import {
  Card,
  Code,
  ErrorBox,
  Field,
  Form,
  Input,
  Notice,
  PageIntro,
  Refresh,
  Select,
  Tabs,
  useActions,
} from "../components";

const template = `# Console-owned table. NetworkManager NAT remains untouched.
destroy table inet openstick_webui
table inet openstick_webui {
    chain input {
        type filter hook input priority -10; policy accept;
        iifname "lo" accept
        ct state established,related accept
        # Add input rules here.
    }
    chain forward {
        type filter hook forward priority -10; policy accept;
    }
}
`;

export default function Firewall() {
  const { data, error, reload } = useData("firewall");
  const { act, notify } = useActions();
  const [tab, setTab] = useState("Managed rules"),
    [config, setConfig] = useState<string | null>(null);
  const [rule, setRule] = useState({
    action: "drop",
    protocol: "tcp",
    port: "80",
    source: "",
    interface: "",
  });
  function appendRule() {
    const port = Number(rule.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      notify("Port must be between 1 and 65535", true);
      return;
    }
    if (rule.source && !/^[0-9a-fA-F.:/]+$/.test(rule.source)) {
      notify("Use an IPv4/IPv6 address or subnet for source", true);
      return;
    }
    if (rule.interface && !/^[a-zA-Z0-9_.-]+$/.test(rule.interface)) {
      notify("Invalid interface", true);
      return;
    }
    const statement = `        ${rule.interface ? `iifname "${rule.interface}" ` : ""}${rule.source ? `${rule.source.includes(":") ? "ip6" : "ip"} saddr ${rule.source} ` : ""}${rule.protocol} dport ${rule.port} ${rule.action}`;
    const current = config ?? (data?.managed || template);
    if (!current.includes("# Add input rules here.")) {
      notify("Insert the rule manually: " + statement, true);
      return;
    }
    setConfig(
      current.replace(
        "# Add input rules here.",
        `${statement.trim()}\n        # Add input rules here.`,
      ),
    );
    notify("Rule added to editor. Review and apply to activate it.");
  }
  return (
    <>
      <PageIntro
        eyebrow="SECURITY"
        title="Firewall"
        description="Native nftables. Explicit rules. No hidden changes."
      >
        <ShieldCheck size={20} />
        <Refresh onClick={reload} />
      </PageIntro>
      <ErrorBox error={error} />
      <Notice danger>
        Firewall changes apply immediately and persist through console service
        restarts. Do not block SSH (22) or this console (8080) on your
        management interface. There is no automatic rollback; keep an SSH
        session open. Existing established connections may remain permitted.
      </Notice>
      <Tabs
        value={tab}
        onChange={setTab}
        items={["Managed rules", "Complete ruleset"]}
      />
      {tab === "Complete ruleset" ? (
        <Card
          title="Complete kernel ruleset"
          subtitle="Includes NetworkManager-managed NAT and forwarding"
        >
          <ErrorBox error={data?.error} />
          <Code>{data?.ruleset}</Code>
        </Card>
      ) : (
        <div className="grid one-two">
          <div className="stack">
            <Card
              title="Rule builder"
              subtitle="Adds a rule to the editor; does not apply it"
            >
              <Form submit="Add to editor" onSubmit={appendRule}>
                <Select
                  label="Action"
                  options={["drop", "accept", "reject"]}
                  value={rule.action}
                  onChange={(event) =>
                    setRule((old) => ({ ...old, action: event.target.value }))
                  }
                />
                <Select
                  label="Protocol"
                  options={["tcp", "udp"]}
                  value={rule.protocol}
                  onChange={(event) =>
                    setRule((old) => ({ ...old, protocol: event.target.value }))
                  }
                />
                <Input
                  label="Destination port"
                  required
                  type="number"
                  min={1}
                  max={65535}
                  value={rule.port}
                  onChange={(event) =>
                    setRule((old) => ({ ...old, port: event.target.value }))
                  }
                />
                <Input
                  label="Source IP / CIDR (optional)"
                  value={rule.source}
                  onChange={(event) =>
                    setRule((old) => ({ ...old, source: event.target.value }))
                  }
                />
                <Input
                  label="Input interface (optional)"
                  placeholder="wlan0"
                  value={rule.interface}
                  onChange={(event) =>
                    setRule((old) => ({
                      ...old,
                      interface: event.target.value,
                    }))
                  }
                />
              </Form>
            </Card>
            <Card title="Recovery">
              <div className="stack">
                <button
                  onClick={() =>
                    act(
                      "firewall.rollback",
                      {},
                      "Restore and apply the last saved firewall backup?",
                    )
                  }
                >
                  Restore previous rules
                </button>
                <button
                  className="danger-text"
                  onClick={() =>
                    act(
                      "firewall.reset",
                      {},
                      "Reset only the console-owned table to accept-by-default? NetworkManager and other tables are not changed.",
                    )
                  }
                >
                  Reset managed firewall
                </button>
              </div>
            </Card>
          </div>
          <Card
            title="Persistent managed rules"
            subtitle="Table: inet openstick_webui · validated before application"
          >
            <Form
              submit="Validate & apply rules"
              onSubmit={() =>
                act(
                  "firewall.save",
                  { config: config ?? (data?.managed || template) },
                  "Apply these nftables rules immediately and save them for boot? A previous copy is kept for manual rollback. Misconfigured rules can block access to this device.",
                )
              }
            >
              <Field label="nftables configuration">
                <textarea
                  className="editor"
                  rows={25}
                  spellCheck={false}
                  value={config ?? (data?.managed || template)}
                  onChange={(event) => setConfig(event.target.value)}
                />
              </Field>
            </Form>
            <p className="muted">
              For DNAT, masquerading or more complex policies, add nat/forward
              chains inside this table. Global rules remain available in the web
              terminal and /etc/nftables.conf. An accept in one table does not
              override a drop in another table.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
