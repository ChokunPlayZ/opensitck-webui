import { useState } from "react";
import {
  MessageSquare,
  Radio,
  Send,
  ShieldAlert,
  Signal,
  Trash2,
} from "lucide-react";
import { api, type Profile, useData } from "../api";
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
import { ProfileEditor } from "./Network";

export default function Cellular() {
  const { data, error, reload } = useData("modem", 15000);
  const network = useData("network");
  const { act, notify } = useActions();
  const [tab, setTab] = useState("Status"),
    [editing, setEditing] = useState<Profile | null>(null);
  const [simForm, setSimForm] = useState({ pin: "", "new-pin": "", puk: "" }),
    [simAction, setSimAction] = useState("sim.pin");
  const [sms, setSMS] = useState({ number: "", text: "" }),
    [smsDetails, setSMSDetails] = useState<any>(null);
  const [allowed, setAllowed] = useState("3g|4g"),
    [preferred, setPreferred] = useState("4g"),
    [bands, setBands] = useState("any"),
    [operator, setOperator] = useState(""),
    [at, setAT] = useState("AT+CSQ"),
    [ussd, setUSSD] = useState("");
  const entry = data?.modems?.[0],
    modem = entry?.data?.modem,
    generic = modem?.generic || {},
    gpp = modem?.["3gpp"] || {};
  const id = entry?.path?.split("/").pop() || "0";
  const simID =
    generic.sim && generic.sim !== "--" ? generic.sim.split("/").pop() : "";
  const sim = entry?.sim?.sim?.properties || entry?.sim?.sim || {};
  const smsPaths: string[] =
    entry?.sms?.["modem.messaging"]?.sms ||
    entry?.sms?.modem?.messaging?.sms ||
    [];
  const cellularProfiles =
    network.data?.profiles?.filter(
      (profile: Profile) => profile.type === "gsm",
    ) || [];
  function modemAct(
    action: string,
    params: Record<string, string> = {},
    warning?: string,
  ) {
    act(action, { modem: id, ...params }, warning);
  }
  return (
    <>
      <PageIntro
        eyebrow="MOBILE BROADBAND"
        title="Cellular & SIM"
        description="Your modem, radio, SIM card and mobile connection."
      >
        <Refresh
          onClick={() => {
            reload();
            network.reload();
          }}
        />
      </PageIntro>
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : !entry ? (
        <Empty>
          No modem reported by ModemManager. Check Services → ModemManager and
          the system logs.
        </Empty>
      ) : (
        <>
          {generic["state-failed-reason"] === "sim-missing" && (
            <Notice danger>
              The modem reports no SIM card. Radio and SMS operations may fail
              until a SIM is installed and the modem is reinitialized.
              Configuration can still be prepared.
            </Notice>
          )}
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              "Status",
              "APN & connection",
              "SIM security",
              "SMS",
              "Radio & advanced",
            ]}
          />
          {tab === "Status" && (
            <div className="grid equal">
              <Card
                title="Modem status"
                actions={
                  <Badge
                    tone={generic.state === "connected" ? "green" : "amber"}
                  >
                    {generic.state}
                  </Badge>
                }
              >
                <KV
                  rows={[
                    [
                      "Manufacturer / model",
                      `${generic.manufacturer} / ${generic.model}`,
                    ],
                    ["IMEI", gpp.imei],
                    ["Firmware", generic.revision],
                    ["Failure reason", generic["state-failed-reason"]],
                    [
                      "Signal quality",
                      `${generic["signal-quality"]?.value || 0}%`,
                    ],
                    ["Operator", gpp["operator-name"]],
                    ["Registration", gpp["registration-state"]],
                    [
                      "Access technology",
                      generic["access-technologies"]?.join(", "),
                    ],
                    ["Current modes", generic["current-modes"]],
                    ["Unlock required", generic["unlock-required"]],
                  ]}
                />
                <div className="inline-actions wrap">
                  <button onClick={() => modemAct("modem.enable")}>
                    <Radio size={14} />
                    Enable
                  </button>
                  <button onClick={() => modemAct("modem.disable")}>
                    Disable
                  </button>
                  <button
                    onClick={() =>
                      modemAct(
                        "modem.reset",
                        {},
                        "Reset the modem? Any active mobile connection will be lost.",
                      )
                    }
                  >
                    Reset modem
                  </button>
                  <button onClick={() => modemAct("modem.signal")}>
                    Enable signal polling
                  </button>
                </div>
              </Card>
              <Card title="SIM information" actions={<Signal size={18} />}>
                {simID ? (
                  <KV
                    rows={Object.entries(sim)
                      .filter(([, value]) => typeof value === "string")
                      .map(
                        ([key, value]) =>
                          [key, String(value)] as [string, string],
                      )}
                  />
                ) : (
                  <Empty>
                    No SIM detected. Insert a SIM before using mobile data.
                  </Empty>
                )}
                <h3 className="section-label">Extended signal metrics</h3>
                <Code>
                  {entry.signal
                    ? JSON.stringify(entry.signal, null, 2)
                    : "Not available. Enable signal polling if supported."}
                </Code>
              </Card>
            </div>
          )}
          {tab === "APN & connection" && (
            <div className="grid equal">
              <Card
                title="Persistent mobile profiles"
                subtitle="Recommended: NetworkManager manages addresses, DNS and routes"
              >
                {cellularProfiles.length ? (
                  cellularProfiles.map((profile: Profile) => (
                    <div className="profile-row" key={profile.uuid}>
                      <div>
                        <strong>{profile.name}</strong>
                        <small>{profile.device || "Not connected"}</small>
                      </div>
                      <div className="inline-actions">
                        <button onClick={() => setEditing(profile)}>
                          APN settings
                        </button>
                        <button
                          className="primary"
                          disabled={!simID}
                          onClick={() =>
                            act(
                              profile.device ? "profile.down" : "profile.up",
                              { uuid: profile.uuid },
                              "Activate or disconnect mobile data? Your carrier may charge for usage.",
                            )
                          }
                        >
                          {profile.device ? "Disconnect" : "Connect"}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <Empty>
                    Create a GSM connection in Network → Connections.
                  </Empty>
                )}
                <Notice>
                  APN settings include APN, username, password, SIM PIN,
                  automatic carrier configuration, home-only (no roaming), IP
                  family, DNS and route priority. Set gsm.auto-config to no when
                  using a manual APN.
                </Notice>
              </Card>
              <Card
                title="Low-level modem connection"
                subtitle="Diagnostic only; does not configure host networking"
              >
                <Form
                  submit="Create modem data bearer"
                  onSubmit={(event) => {
                    const form = new FormData(event.currentTarget);
                    modemAct(
                      "modem.connect",
                      {
                        apn: String(form.get("apn")),
                        "ip-type": String(form.get("ip-type")),
                      },
                      "This creates a modem bearer only, without host IP/DNS/routes. Use a NetworkManager profile for a working internet connection. Carrier charges may apply.",
                    );
                  }}
                >
                  <Input
                    label="APN"
                    name="apn"
                    defaultValue="internet"
                    required
                  />
                  <Select
                    label="IP family"
                    name="ip-type"
                    options={["ipv4", "ipv4v6", "ipv6"]}
                  />
                </Form>
                <button onClick={() => modemAct("modem.disconnect")}>
                  Disconnect all modem bearers
                </button>
              </Card>
            </div>
          )}
          {tab === "SIM security" && (
            <div className="grid equal">
              <Card
                title="PIN & PUK management"
                actions={<ShieldAlert size={18} />}
              >
                <Notice danger>
                  Wrong PIN/PUK attempts can permanently lock the SIM. Check
                  remaining retries in the status below. Never guess your PUK;
                  request it from your carrier.
                </Notice>
                <Form
                  submit="Apply SIM operation"
                  onSubmit={() =>
                    modemAct(
                      simAction,
                      { sim: simID, ...simForm },
                      "Verify the PIN/PUK carefully. Incorrect attempts consume retries and can permanently disable the SIM.",
                    )
                  }
                >
                  <Select
                    label="Operation"
                    value={simAction}
                    onChange={(event) => setSimAction(event.target.value)}
                    options={[
                      ["sim.pin", "Unlock SIM with PIN"],
                      ["sim.enable-pin", "Enable PIN lock"],
                      ["sim.disable-pin", "Disable PIN lock"],
                      ["sim.change-pin", "Change PIN"],
                      ["sim.puk", "Unblock with PUK"],
                    ]}
                  />
                  <Input
                    label={simAction === "sim.puk" ? "New PIN" : "Current PIN"}
                    type="password"
                    required
                    minLength={4}
                    maxLength={8}
                    pattern="[0-9]+"
                    value={simForm.pin}
                    onChange={(event) =>
                      setSimForm((old) => ({ ...old, pin: event.target.value }))
                    }
                  />
                  {simAction === "sim.change-pin" && (
                    <Input
                      label="New PIN"
                      type="password"
                      required
                      minLength={4}
                      maxLength={8}
                      pattern="[0-9]+"
                      value={simForm["new-pin"]}
                      onChange={(event) =>
                        setSimForm((old) => ({
                          ...old,
                          "new-pin": event.target.value,
                        }))
                      }
                    />
                  )}{" "}
                  {simAction === "sim.puk" && (
                    <Input
                      label="PUK"
                      type="password"
                      required
                      minLength={8}
                      maxLength={8}
                      pattern="[0-9]+"
                      value={simForm.puk}
                      onChange={(event) =>
                        setSimForm((old) => ({
                          ...old,
                          puk: event.target.value,
                        }))
                      }
                    />
                  )}
                </Form>
              </Card>
              <Card title="Lock status">
                <KV
                  rows={[
                    ["SIM ID", simID || "Not detected"],
                    ["Unlock required", generic["unlock-required"]],
                    [
                      "Enabled locks",
                      gpp["enabled-locks"]?.join(", ") || "None reported",
                    ],
                  ]}
                />
                <Code>
                  {JSON.stringify(generic["unlock-retries"], null, 2)}
                </Code>
              </Card>
            </div>
          )}
          {tab === "SMS" && (
            <div className="grid equal">
              <Card
                title="Messages"
                subtitle="Create a draft, then send it explicitly"
                actions={<MessageSquare size={18} />}
              >
                {smsPaths.length ? (
                  smsPaths.map((path) => {
                    const smsID =
                      path.match(/SMS\/(\d+)/)?.[1] ||
                      path.split("/").pop() ||
                      "";
                    return (
                      <div className="profile-row" key={path}>
                        <span className="mono">SMS {smsID}</span>
                        <div className="inline-actions">
                          <button
                            onClick={async () => {
                              try {
                                setSMSDetails(await api(`sms?id=${smsID}`));
                              } catch (error) {
                                notify((error as Error).message, true);
                              }
                            }}
                          >
                            Read
                          </button>
                          <button
                            onClick={() =>
                              modemAct(
                                "sms.send",
                                { sms: smsID },
                                "Send this SMS? Carrier charges may apply.",
                              )
                            }
                          >
                            <Send size={13} />
                            Send
                          </button>
                          <button
                            title="Delete SMS"
                            className="icon-button danger-text"
                            onClick={() =>
                              modemAct("sms.delete", { sms: smsID })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <Empty>
                    No messages, or messaging is unavailable until the modem is
                    enabled.
                  </Empty>
                )}
              </Card>
              <Card title="Compose message">
                <Form
                  submit="Create SMS draft"
                  onSubmit={() => modemAct("sms.create", sms)}
                >
                  <Input
                    label="Destination number"
                    type="tel"
                    placeholder="+66123456789"
                    required
                    value={sms.number}
                    onChange={(event) =>
                      setSMS((old) => ({ ...old, number: event.target.value }))
                    }
                  />
                  <Field label="Message">
                    <textarea
                      required
                      rows={6}
                      maxLength={1600}
                      value={sms.text}
                      onChange={(event) =>
                        setSMS((old) => ({ ...old, text: event.target.value }))
                      }
                    />
                  </Field>
                </Form>
              </Card>
            </div>
          )}
          {tab === "Radio & advanced" && (
            <>
              <Notice>
                Only choose modes and bands listed as supported by this modem.
                Unsupported commands will report the modem’s error. Raw AT
                commands may require ModemManager debug mode; the console will
                not enable debug mode automatically.
              </Notice>
              <div className="grid equal">
                <Card title="Radio mode & bands">
                  <Form
                    submit="Set radio modes"
                    onSubmit={() =>
                      modemAct("modem.modes", { allowed, preferred })
                    }
                  >
                    <Select
                      label="Allowed modes"
                      value={allowed}
                      onChange={(event) => setAllowed(event.target.value)}
                      options={["3g|4g", "4g", "3g", "any"]}
                    />
                    <Select
                      label="Preferred mode"
                      value={preferred}
                      onChange={(event) => setPreferred(event.target.value)}
                      options={["4g", "3g", "none"]}
                    />
                  </Form>
                  <Form
                    submit="Set bands"
                    onSubmit={() => modemAct("modem.bands", { bands })}
                  >
                    <Input
                      label="Bands (pipe-separated)"
                      value={bands}
                      onChange={(event) => setBands(event.target.value)}
                      hint="Example: eutran-1|eutran-3|eutran-8 or any"
                    />
                  </Form>
                  <h3 className="section-label">Supported by this modem</h3>
                  <Code>
                    {JSON.stringify(
                      {
                        modes: generic["supported-modes"],
                        bands: generic["supported-bands"],
                      },
                      null,
                      2,
                    )}
                  </Code>
                </Card>
                <div className="stack">
                  <Card title="Operator selection">
                    <Form
                      submit="Register operator"
                      onSubmit={() => modemAct("modem.register", { operator })}
                    >
                      <Input
                        label="MCC/MNC (blank = home network)"
                        placeholder="52001"
                        value={operator}
                        onChange={(event) => setOperator(event.target.value)}
                      />
                    </Form>
                    <button
                      onClick={() =>
                        modemAct(
                          "modem.scan",
                          {},
                          "Scanning operators can interrupt mobile data and take up to two minutes.",
                        )
                      }
                    >
                      Scan available operators
                    </button>
                  </Card>
                  <Card title="USSD & AT commands">
                    <Form
                      submit="Send USSD"
                      onSubmit={() => modemAct("modem.ussd", { command: ussd })}
                    >
                      <Input
                        label="USSD code"
                        placeholder="*123#"
                        value={ussd}
                        onChange={(event) => setUSSD(event.target.value)}
                      />
                    </Form>
                    <Form
                      submit="Execute AT command"
                      onSubmit={() =>
                        modemAct(
                          "modem.at",
                          { command: at },
                          "Execute a raw AT command? Commands can change persistent modem state. Only run commands you understand.",
                        )
                      }
                    >
                      <Input
                        label="AT command"
                        value={at}
                        onChange={(event) => setAT(event.target.value)}
                      />
                    </Form>
                  </Card>
                  <Card title="Modem power">
                    <div className="inline-actions wrap">
                      {["on", "low", "off"].map((state) => (
                        <button
                          key={state}
                          onClick={() => modemAct("modem.power", { state })}
                        >
                          {state}
                        </button>
                      ))}
                    </div>
                  </Card>
                </div>
              </div>
            </>
          )}
        </>
      )}
      {editing && (
        <ProfileEditor
          profile={editing}
          onClose={() => {
            setEditing(null);
            network.reload();
          }}
        />
      )}{" "}
      {smsDetails && (
        <Modal title="SMS details" onClose={() => setSMSDetails(null)}>
          <Code>{JSON.stringify(smsDetails, null, 2)}</Code>
        </Modal>
      )}
    </>
  );
}
