import { useState } from "react";
import { ArrowDownToLine, Pencil, Plus, Trash2 } from "lucide-react";
import { api, bytes, encode, type Profile, useData } from "../api";
import {
  Badge,
  Card,
  Code,
  Empty,
  ErrorBox,
  Field,
  Form,
  Input,
  KV,
  Loading,
  Modal,
  Notice,
  PageIntro,
  Refresh,
  Select,
  Tabs,
  useActions,
} from "../components";

const propertyGroups: Record<string, string[]> = {
  Connection: [
    "connection.id",
    "connection.interface-name",
    "connection.autoconnect",
    "connection.autoconnect-priority",
  ],
  IPv4: [
    "ipv4.method",
    "ipv4.addresses",
    "ipv4.gateway",
    "ipv4.dns",
    "ipv4.dns-search",
    "ipv4.ignore-auto-dns",
    "ipv4.routes",
    "ipv4.route-metric",
    "ipv4.never-default",
    "ipv4.may-fail",
    "ipv4.dhcp-client-id",
  ],
  IPv6: [
    "ipv6.method",
    "ipv6.addresses",
    "ipv6.gateway",
    "ipv6.dns",
    "ipv6.ignore-auto-dns",
    "ipv6.routes",
    "ipv6.route-metric",
    "ipv6.never-default",
  ],
  WiFi: [
    "802-11-wireless.ssid",
    "802-11-wireless.mode",
    "802-11-wireless.band",
    "802-11-wireless.channel",
    "802-11-wireless.hidden",
    "802-11-wireless.mtu",
    "802-11-wireless.cloned-mac-address",
    "802-11-wireless-security.key-mgmt",
    "802-11-wireless-security.psk",
  ],
  Ethernet: ["802-3-ethernet.mtu", "802-3-ethernet.cloned-mac-address"],
  Cellular: [
    "gsm.apn",
    "gsm.username",
    "gsm.password",
    "gsm.auto-config",
    "gsm.home-only",
    "gsm.pin",
    "gsm.network-id",
    "gsm.number",
  ],
};
const propertyChoices: Record<string, string[]> = {
  "ipv4.method": ["auto", "manual", "shared", "disabled", "link-local"],
  "ipv6.method": [
    "auto",
    "manual",
    "disabled",
    "ignore",
    "link-local",
    "shared",
  ],
  "802-11-wireless.mode": ["infrastructure", "ap", "adhoc", "mesh"],
  "802-11-wireless-security.key-mgmt": ["", "wpa-psk", "sae", "none"],
  "802-11-wireless.band": ["", "bg", "a"],
};

export function ProfileEditor({
  profile,
  onClose,
}: {
  profile: Profile;
  onClose: () => void;
}) {
  const { data, error } = useData<Record<string, string>>(
    `profile?uuid=${encode(profile.uuid)}`,
  );
  const [changes, setChanges] = useState<Record<string, string>>({});
  const { act } = useActions();
  const groups = [
    "Connection",
    "IPv4",
    "IPv6",
    ...(profile.type.includes("wireless") ? ["WiFi"] : []),
    ...(profile.type === "gsm" ? ["Cellular"] : []),
    ...(profile.type.includes("ethernet") ? ["Ethernet"] : []),
  ];
  const [tab, setTab] = useState(groups[0]);
  return (
    <Modal wide title={`Edit connection · ${profile.name}`} onClose={onClose}>
      <ErrorBox error={error} />
      <Notice>
        Only edited fields are saved. Reconnect the profile to activate changes.
        Changing the USB address or current uplink can disconnect this page.
        Secret values are not read back; leave them untouched to keep them.
      </Notice>
      <Tabs value={tab} onChange={setTab} items={groups} />
      {data ? (
        <Form
          onSubmit={() =>
            act(
              "profile.save",
              { uuid: profile.uuid, ...changes },
              "Save the edited connection settings? They persist across reboots. Reconnect the profile when you are ready to activate them.",
            )
          }
        >
          <div className="form-grid">
            {propertyGroups[tab].map((property) => {
              const value =
                changes[property] ??
                (data[property] === "--" ? "" : data[property] || "");
              const update = (value: string) =>
                setChanges((old) => ({ ...old, [property]: value }));
              const secret = /password|psk|gsm.pin/.test(property);
              return propertyChoices[property] ? (
                <Select
                  key={property}
                  label={property}
                  value={value}
                  onChange={(event) => update(event.target.value)}
                  options={[...new Set([value, ...propertyChoices[property]])]}
                />
              ) : (
                <Input
                  key={property}
                  label={property}
                  type={secret ? "password" : "text"}
                  value={secret && !(property in changes) ? "" : value}
                  placeholder={
                    secret ? "Leave unchanged to keep stored secret" : ""
                  }
                  onChange={(event) => update(event.target.value)}
                />
              );
            })}
          </div>
          <small className="muted">
            NetworkManager syntax: addresses 192.168.5.1/24 · DNS
            1.1.1.1,9.9.9.9 · routes “10.0.0.0/8 192.168.5.2 100” · shared
            enables DHCP and NAT.
          </small>
        </Form>
      ) : (
        <Loading />
      )}
    </Modal>
  );
}

export default function Network() {
  const { data, error, reload } = useData("network", 15000);
  const { act } = useActions();
  const [tab, setTab] = useState("Connections"),
    [editing, setEditing] = useState<Profile | null>(null),
    [creating, setCreating] = useState(false);
  const [route, setRoute] = useState({
    destination: "",
    gateway: "",
    interface: "usb0",
    metric: "",
    ipv6: "no",
  });
  const [connection, setConnection] = useState({
    name: "",
    type: "ethernet",
    interface: "usb1",
    ssid: "",
    apn: "internet",
    vlan: "100",
    parent: "usb0",
  });
  return (
    <>
      <PageIntro
        eyebrow="CONNECTIVITY"
        title="Network"
        description="Interfaces, persistent connections, DNS, DHCP and routing."
      >
        <Refresh onClick={reload} />
      </PageIntro>
      <ErrorBox error={error} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={["Connections", "Interfaces", "Routing", "Clients & DNS"]}
      />
      {!data ? (
        <Loading />
      ) : (
        <>
          {tab === "Connections" && (
            <Card
              title="Connection profiles"
              subtitle="NetworkManager is the source of truth"
              actions={
                <button className="primary" onClick={() => setCreating(true)}>
                  <Plus size={14} />
                  New connection
                </button>
              }
            >
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Connection</th>
                      <th>Type</th>
                      <th>Interface</th>
                      <th>Autoconnect</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.profiles?.map((profile: Profile) => (
                      <tr key={profile.uuid}>
                        <td>
                          <strong>{profile.name}</strong>
                          <small>{profile.uuid}</small>
                        </td>
                        <td>
                          {profile.type
                            .replace("802-11-", "")
                            .replace("802-3-", "")}
                        </td>
                        <td>{profile.device || "—"}</td>
                        <td>
                          <Badge
                            tone={
                              profile.autoconnect === "yes"
                                ? "green"
                                : "neutral"
                            }
                          >
                            {profile.autoconnect}
                          </Badge>
                        </td>
                        <td>
                          <div className="inline-actions">
                            <button
                              title="Edit profile"
                              onClick={() => setEditing(profile)}
                            >
                              <Pencil size={13} />
                              Edit
                            </button>
                            <button
                              onClick={() =>
                                act(
                                  profile.device
                                    ? "profile.down"
                                    : "profile.up",
                                  { uuid: profile.uuid },
                                  `${profile.device ? "Disconnect" : "Activate"} ${profile.name}? This can end your current connection. ${profile.type.includes("wireless") ? (profile.device ? "This Wi-Fi profile will stay disconnected after reboot. " : "This Wi-Fi profile will be preferred after reboot. ") : ""}USB management is recommended for Wi-Fi changes.`,
                                )
                              }
                            >
                              {profile.device ? "Disconnect" : "Connect"}
                            </button>
                            <button
                              className="icon-button danger-text"
                              title="Delete profile"
                              onClick={() =>
                                act(
                                  "profile.delete",
                                  { uuid: profile.uuid },
                                  `Permanently delete ${profile.name}?`,
                                )
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {tab === "Interfaces" && (
            <div className="grid equal">
              {data.interfaces?.map((iface: any) => (
                <Card
                  key={iface.ifindex}
                  title={iface.ifname}
                  subtitle={iface.address}
                  actions={
                    <Badge
                      tone={iface.operstate === "UP" ? "green" : "neutral"}
                    >
                      {iface.operstate}
                    </Badge>
                  }
                >
                  <KV
                    rows={[
                      [
                        "IPv4",
                        iface.addr_info
                          ?.filter((address: any) => address.family === "inet")
                          .map(
                            (address: any) =>
                              `${address.local}/${address.prefixlen}`,
                          )
                          .join(", "),
                      ],
                      [
                        "IPv6",
                        iface.addr_info
                          ?.filter((address: any) => address.family === "inet6")
                          .map(
                            (address: any) =>
                              `${address.local}/${address.prefixlen}`,
                          )
                          .join(", "),
                      ],
                      ["MTU", iface.mtu],
                      ["Received", bytes(iface.stats64?.rx?.bytes)],
                      ["Transmitted", bytes(iface.stats64?.tx?.bytes)],
                    ]}
                  />
                </Card>
              ))}
            </div>
          )}
          {tab === "Routing" && (
            <>
              <Notice>
                Live route changes are temporary. For persistent routes, edit a
                connection’s ipv4.routes / ipv6.routes. Be careful when changing
                the default route or forwarding.
              </Notice>
              <div className="grid two-one">
                <Card title="Routing table" subtitle="IPv4 · all tables">
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Destination</th>
                          <th>Gateway</th>
                          <th>Device</th>
                          <th>Metric</th>
                          <th>Table</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.routes?.map((entry: any, index: number) => (
                          <tr key={index}>
                            <td>{entry.dst || "default"}</td>
                            <td>{entry.gateway || "On-link"}</td>
                            <td>{entry.dev}</td>
                            <td>{entry.metric ?? "—"}</td>
                            <td>{entry.table || "main"}</td>
                            <td>
                              {!entry.table && (
                                <button
                                  className="icon-button danger-text"
                                  title="Delete route"
                                  onClick={() =>
                                    act(
                                      "route.delete",
                                      {
                                        destination: entry.dst || "default",
                                        gateway: entry.gateway || "",
                                        interface: entry.dev,
                                        metric: String(entry.metric || ""),
                                      },
                                      "Delete this live route? Deleting your management route can disconnect the browser.",
                                    )
                                  }
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <h3 className="section-label">IPv6 routes</h3>
                  <Code>{JSON.stringify(data.routes6, null, 2)}</Code>
                </Card>
                <div className="stack">
                  <Card title="Add live route">
                    <Form
                      submit="Add route"
                      onSubmit={() => act("route.add", route)}
                    >
                      {Object.entries(route)
                        .filter(([key]) => key !== "ipv6")
                        .map(([key, value]) => (
                          <Input
                            key={key}
                            label={key}
                            value={value}
                            required={
                              key === "destination" || key === "interface"
                            }
                            onChange={(event) =>
                              setRoute((old) => ({
                                ...old,
                                [key]: event.target.value,
                              }))
                            }
                          />
                        ))}
                      <Select
                        label="Address family"
                        options={[
                          ["no", "IPv4"],
                          ["yes", "IPv6"],
                        ]}
                        value={route.ipv6}
                        onChange={(event) =>
                          setRoute((old) => ({
                            ...old,
                            ipv6: event.target.value,
                          }))
                        }
                      />
                    </Form>
                  </Card>
                  <Card title="IP forwarding">
                    <p className="muted">
                      Current IPv4 state:{" "}
                      <strong>
                        {data.forwarding === "1" ? "Enabled" : "Disabled"}
                      </strong>
                      . NetworkManager shared profiles manage their own NAT.
                    </p>
                    <button
                      onClick={() =>
                        act(
                          "forwarding",
                          { value: data.forwarding === "1" ? "0" : "1" },
                          "Change IPv4 and IPv6 forwarding persistently? Disabling forwarding can break tethering and VPN routing.",
                        )
                      }
                    >
                      {data.forwarding === "1" ? "Disable" : "Enable"}{" "}
                      forwarding
                    </button>
                  </Card>
                </div>
              </div>
            </>
          )}
          {tab === "Clients & DNS" && (
            <div className="grid equal">
              <Card
                title="DHCP leases"
                subtitle="NetworkManager / dnsmasq leases"
              >
                {data.leases?.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Client</th>
                          <th>IP address</th>
                          <th>MAC</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.leases.map((lease: any, index: number) => (
                          <tr key={index}>
                            <td>{lease.hostname}</td>
                            <td>{lease.ip}</td>
                            <td className="mono">{lease.mac}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>No DHCP leases found.</Empty>
                )}
                <h3 className="section-label">Neighbor discovery</h3>
                <Code>{JSON.stringify(data.neighbors, null, 2)}</Code>
              </Card>
              <Card
                title="DNS resolver"
                subtitle="Edit DNS per connection to persist changes"
              >
                <Code>{data.dns}</Code>
                <Notice>
                  Use a connection’s ipv4.dns and ipv4.ignore-auto-dns fields
                  for custom resolvers. Shared profiles provide DHCP/DNS/NAT
                  automatically; a second global dnsmasq instance can conflict
                  on port 53.
                </Notice>
                <button onClick={() => setTab("Connections")}>
                  Edit connection DNS
                  <ArrowDownToLine size={14} />
                </button>
              </Card>
            </div>
          )}
        </>
      )}
      {editing && (
        <ProfileEditor
          profile={editing}
          onClose={() => {
            setEditing(null);
            reload();
          }}
        />
      )}{" "}
      {creating && (
        <Modal
          title="New connection profile"
          onClose={() => setCreating(false)}
        >
          <Form onSubmit={() => act("profile.create", connection)}>
            <Input
              label="Name"
              value={connection.name}
              required
              onChange={(event) =>
                setConnection((old) => ({ ...old, name: event.target.value }))
              }
            />
            <Select
              label="Type"
              value={connection.type}
              options={["ethernet", "wifi", "gsm", "bridge", "vlan"]}
              onChange={(event) =>
                setConnection((old) => ({ ...old, type: event.target.value }))
              }
            />
            <Input
              label="Interface"
              value={connection.interface}
              required
              onChange={(event) =>
                setConnection((old) => ({
                  ...old,
                  interface: event.target.value,
                }))
              }
            />
            {connection.type === "wifi" && (
              <Input
                label="SSID"
                value={connection.ssid}
                onChange={(event) =>
                  setConnection((old) => ({ ...old, ssid: event.target.value }))
                }
              />
            )}{" "}
            {connection.type === "gsm" && (
              <Input
                label="APN"
                value={connection.apn}
                onChange={(event) =>
                  setConnection((old) => ({ ...old, apn: event.target.value }))
                }
              />
            )}{" "}
            {connection.type === "vlan" && (
              <>
                <Input
                  label="Parent interface"
                  value={connection.parent}
                  onChange={(event) =>
                    setConnection((old) => ({
                      ...old,
                      parent: event.target.value,
                    }))
                  }
                />
                <Input
                  label="VLAN ID"
                  value={connection.vlan}
                  onChange={(event) =>
                    setConnection((old) => ({
                      ...old,
                      vlan: event.target.value,
                    }))
                  }
                />
              </>
            )}
          </Form>
        </Modal>
      )}
    </>
  );
}
