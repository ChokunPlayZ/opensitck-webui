import { useState } from "react";
import {
  Check,
  LoaderCircle,
  LockKeyhole,
  Radio,
  Wifi as WifiIcon,
} from "lucide-react";
import { type Profile, useData } from "../api";
import { JobStatus, useOperation } from "../jobs";
import {
  Badge,
  Card,
  Empty,
  ErrorBox,
  Form,
  Input,
  Loading,
  Notice,
  PageIntro,
  Refresh,
  Select,
  Tabs,
  useActions,
} from "../components";
import { ProfileEditor } from "./Network";

export default function Wifi() {
  const { data, error, reload } = useData("network", 12000);
  const { act } = useActions();
  const scan = useOperation("wifi.scan");
  const [tab, setTab] = useState("Client"),
    [editing, setEditing] = useState<Profile | null>(null);
  const [client, setClient] = useState({
    ssid: "",
    password: "",
    interface: "wlan0",
    hidden: "no",
  });
  const [ap, setAP] = useState({
    ssid: "Openstick",
    password: "",
    interface: "wlan0",
    band: "bg",
  });
  const warning = `The stick has one Wi-Fi radio. Switching client/AP mode replaces its current Wi-Fi connection and can remove internet access. Connecting or starting a hotspot makes it preferred after reboot; disconnecting or stopping a saved profile disables its autoconnect. Keep a USB connection${data?.managementURL ? ` to ${data.managementURL}` : " to the stick"} for recovery.`;
  return (
    <>
      <PageIntro
        eyebrow="WIRELESS"
        title="Wi-Fi"
        description="Join a network. Create your own. Stay connected."
      >
        <Badge tone={data?.radio === "enabled" ? "green" : "neutral"}>
          Radio {data?.radio || "…"}
        </Badge>
        <Refresh onClick={reload} />
      </PageIntro>
      <ErrorBox error={error} />
      <Notice>{warning}</Notice>
      <Tabs
        value={tab}
        onChange={setTab}
        items={["Client", "Access point", "Saved networks"]}
      />
      {tab === "Client" && (
        <div className="grid two-one">
          <Card
            title="Nearby networks"
            subtitle="Scan on the stick, then select a network to join"
            actions={
              <button
                disabled={scan.running || data?.radio === "disabled"}
                onClick={() => act("wifi.scan")}
              >
                {scan.running ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Radio size={14} />
                )}
                {scan.running ? "Scanning…" : "Scan networks"}
              </button>
            }
          >
            <ErrorBox error={scan.error} />
            {scan.job && (
              <JobStatus
                key={scan.job.id}
                job={scan.job}
                title={
                  scan.running
                    ? "Looking for nearby networks"
                    : scan.job.status === "success"
                      ? "Scan complete"
                      : "Scan could not complete"
                }
                description={
                  scan.running
                    ? "Scanning with the stick’s Wi-Fi radio. Results will update here automatically."
                    : scan.job.status === "success"
                      ? "Nearby networks refresh automatically. Select one below to connect."
                      : "Cached networks are kept below. Check the device output and try again."
                }
              />
            )}
            {data?.radio === "disabled" && (
              <Notice>
                Wi-Fi is off. Turn on the radio to scan for nearby networks.
              </Notice>
            )}
            {!data ? (
              <Loading />
            ) : data.wifi?.length ? (
              <div className="wifi-list">
                {data.wifi.map((row: string[], index: number) => (
                  <button
                    key={index}
                    className={
                      client.ssid && client.ssid === row[1] ? "selected" : ""
                    }
                    aria-pressed={Boolean(
                      client.ssid && client.ssid === row[1],
                    )}
                    onClick={() =>
                      setClient((old) => ({ ...old, ssid: row[1] }))
                    }
                  >
                    <div className="wifi-signal">
                      <WifiIcon size={21} />
                    </div>
                    <span className="wifi-name">
                      <strong>{row[1] || "Hidden network"}</strong>
                      <small>
                        {row[3] || "Open"} · Channel {row[4]} · {row[5]}
                      </small>
                    </span>
                    {row[0] === "*" ? (
                      <Badge tone="green">Connected</Badge>
                    ) : (
                      <span className="muted">{row[2]}%</span>
                    )}
                    {client.ssid && client.ssid === row[1] ? (
                      <Check size={16} />
                    ) : (
                      row[3] &&
                      row[3] !== "--" && (
                        <LockKeyhole size={14} className="muted" />
                      )
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <Empty>
                {scan.running
                  ? "Searching for networks…"
                  : scan.job?.status === "success"
                    ? "No nearby networks found. Try scanning again or enter a network name manually."
                    : "Scan to discover nearby networks. Results will appear here."}
              </Empty>
            )}
          </Card>
          <div className="stack">
            <Card
              title="Join a network"
              subtitle="Creates a saved NetworkManager profile"
            >
              <Form
                submit="Connect to Wi-Fi"
                onSubmit={() => act("wifi.connect", client, warning)}
              >
                <Input
                  label="Network name (SSID)"
                  required
                  maxLength={32}
                  value={client.ssid}
                  onChange={(event) =>
                    setClient((old) => ({ ...old, ssid: event.target.value }))
                  }
                />
                <Input
                  label="Password"
                  type="password"
                  value={client.password}
                  placeholder="Leave blank for open networks"
                  onChange={(event) =>
                    setClient((old) => ({
                      ...old,
                      password: event.target.value,
                    }))
                  }
                />
                <Input
                  label="Interface"
                  value={client.interface}
                  onChange={(event) =>
                    setClient((old) => ({
                      ...old,
                      interface: event.target.value,
                    }))
                  }
                />
                <Select
                  label="Hidden network"
                  options={["no", "yes"]}
                  value={client.hidden}
                  onChange={(event) =>
                    setClient((old) => ({ ...old, hidden: event.target.value }))
                  }
                />
              </Form>
            </Card>
            <Card title="Radio control">
              <p className="muted">
                Disabling the radio disconnects both client and AP connections.
              </p>
              <button
                onClick={() =>
                  act(
                    "wifi.radio",
                    { state: data?.radio === "enabled" ? "off" : "on" },
                    warning,
                  )
                }
              >
                Turn Wi-Fi {data?.radio === "enabled" ? "off" : "on"}
              </button>
            </Card>
          </div>
        </div>
      )}
      {tab === "Access point" && (
        <div className="grid equal">
          <Card
            title="Start a secure hotspot"
            subtitle={
              data?.hotspotBridge
                ? "Shares the existing USB LAN gateway and DHCP/DNS service"
                : "NetworkManager handles DHCP, DNS and NAT"
            }
          >
            <ErrorBox error={data?.hotspotBridgeError} />
            {data?.hotspotBridge && (
              <Notice>
                The hotspot joins LAN bridge <code>{data.hotspotBridge}</code>.
                Hotspot and USB clients can open{" "}
                <a href={data.managementURL}>{data.managementURL}</a>. Wi-Fi
                client mode and cellular remain excluded from WebUI access.
              </Notice>
            )}
            <Form
              submit="Start access point"
              onSubmit={() => act("wifi.hotspot", ap, warning)}
            >
              <Input
                label="Network name (SSID)"
                required
                maxLength={32}
                value={ap.ssid}
                onChange={(event) =>
                  setAP((old) => ({ ...old, ssid: event.target.value }))
                }
              />
              <Input
                label="WPA password"
                required
                type="password"
                minLength={8}
                maxLength={63}
                value={ap.password}
                onChange={(event) =>
                  setAP((old) => ({ ...old, password: event.target.value }))
                }
              />
              <Input
                label="Wireless interface"
                value={ap.interface}
                onChange={(event) =>
                  setAP((old) => ({ ...old, interface: event.target.value }))
                }
              />
              <Select
                label="Band (hardware must support it)"
                value={ap.band}
                options={[
                  ["bg", "2.4 GHz"],
                  ["a", "5 GHz"],
                ]}
                onChange={(event) =>
                  setAP((old) => ({ ...old, band: event.target.value }))
                }
              />
            </Form>
          </Card>
          <Card
            title="Existing AP profiles"
            subtitle={
              data?.hotspotBridge
                ? "Bridged AP profiles inherit the USB LAN subnet"
                : "Set SSID, password, channel and subnet before activation"
            }
          >
            {data?.profiles
              ?.filter((profile: Profile) => profile.type.includes("wireless"))
              .map((profile: Profile) => (
                <div className="profile-row" key={profile.uuid}>
                  <div>
                    <strong>{profile.name}</strong>
                    <small>{profile.device || "Inactive"}</small>
                  </div>
                  <div className="inline-actions">
                    <button onClick={() => setEditing(profile)}>
                      Configure
                    </button>
                    <button
                      onClick={() =>
                        act(
                          profile.device ? "profile.down" : "profile.up",
                          { uuid: profile.uuid },
                          warning,
                        )
                      }
                    >
                      {profile.device ? "Stop" : "Activate"}
                    </button>
                  </div>
                </div>
              ))}
            <Notice>
              The factory hotspot profile normally uses 192.168.4.1/24. A newly
              created hotspot may use NetworkManager’s 10.42.x.1 subnet. Check
              Network → Interfaces after activation. Change ipv4.addresses on
              the profile to choose a subnet.
            </Notice>
          </Card>
        </div>
      )}
      {tab === "Saved networks" && (
        <Card title="Saved wireless profiles">
          {data?.profiles
            ?.filter((profile: Profile) => profile.type.includes("wireless"))
            .map((profile: Profile) => (
              <div className="profile-row" key={profile.uuid}>
                <div>
                  <strong>{profile.name}</strong>
                  <small>{profile.uuid}</small>
                </div>
                <div className="inline-actions">
                  <Badge tone={profile.device ? "green" : "neutral"}>
                    {profile.device || "Inactive"}
                  </Badge>
                  <button onClick={() => setEditing(profile)}>
                    Edit profile
                  </button>
                  <button
                    onClick={() =>
                      act(
                        profile.device ? "profile.down" : "profile.up",
                        { uuid: profile.uuid },
                        warning,
                      )
                    }
                  >
                    {profile.device ? "Disconnect" : "Connect"}
                  </button>
                </div>
              </div>
            ))}
        </Card>
      )}
      {editing && (
        <ProfileEditor
          profile={editing}
          onClose={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}
