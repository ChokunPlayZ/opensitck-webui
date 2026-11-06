import { useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { api, useData } from "../api";
import {
  Card,
  Code,
  Empty,
  ErrorBox,
  Field,
  Form,
  Input,
  KV,
  Notice,
  PageIntro,
  Refresh,
  useActions,
} from "../components";

const template = `[Interface]
# Generate a key pair, then replace the private key below.
PrivateKey = REPLACE_WITH_PRIVATE_KEY
Address = 10.8.0.2/32
# DNS = 1.1.1.1

[Peer]
PublicKey = REPLACE_WITH_SERVER_PUBLIC_KEY
Endpoint = vpn.example.com:51820
AllowedIPs = 10.8.0.0/24
PersistentKeepalive = 25
`;

export default function Wireguard() {
  const { data, error, reload } = useData("wireguard", 10000);
  const { act, notify } = useActions();
  const [name, setName] = useState("wg0"),
    [config, setConfig] = useState(template),
    [keys, setKeys] = useState<{ private: string; public: string } | null>(
      null,
    );
  return (
    <>
      <PageIntro
        eyebrow="PRIVATE NETWORKING"
        title="WireGuard"
        description="Fast, encrypted tunnels. Native to your device."
      >
        <Refresh onClick={reload} />
        <button
          onClick={() => {
            setName("wg0");
            setConfig(template);
          }}
        >
          <Plus size={14} />
          New tunnel
        </button>
      </PageIntro>
      <ErrorBox error={error} />
      <div className="grid one-two">
        <div className="stack">
          <Card
            title="Saved tunnels"
            subtitle="Click a tunnel to edit its configuration"
          >
            {data?.configs?.length ? (
              data.configs.map((tunnel: any) => (
                <div className="tunnel-item" key={tunnel.name}>
                  <button
                    className="text-button"
                    onClick={() => {
                      setName(tunnel.name);
                      setConfig(tunnel.config);
                    }}
                  >
                    {tunnel.name}
                  </button>
                  <div className="inline-actions wrap">
                    <button
                      onClick={() =>
                        act(
                          "wireguard.up",
                          { name: tunnel.name },
                          "Bring up this tunnel? Default-route AllowedIPs can change internet and management routing.",
                        )
                      }
                    >
                      Start
                    </button>
                    <button
                      onClick={() =>
                        act("wireguard.down", { name: tunnel.name })
                      }
                    >
                      Stop
                    </button>
                    <button
                      onClick={() =>
                        act("wireguard.enable", { name: tunnel.name })
                      }
                    >
                      Autostart on
                    </button>
                    <button
                      onClick={() =>
                        act("wireguard.disable", { name: tunnel.name })
                      }
                    >
                      Autostart off
                    </button>
                    <button
                      className="danger-text"
                      onClick={() =>
                        act("wireguard.delete", { name: tunnel.name })
                      }
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <Empty>No saved tunnels yet.</Empty>
            )}
          </Card>
          <Card
            title="Key generator"
            subtitle="Keys are generated locally on this stick"
          >
            <button
              onClick={async () => {
                try {
                  const value = await api("wireguard/keys", {});
                  setKeys(value);
                  notify("Key pair generated. Nothing has been saved yet.");
                } catch (error) {
                  notify((error as Error).message, true);
                }
              }}
            >
              <KeyRound size={15} />
              Generate key pair
            </button>
            {keys && (
              <>
                <KV
                  rows={[
                    [
                      "Public key",
                      <span className="mono break-all">{keys.public}</span>,
                    ],
                  ]}
                />
                <Field label="Private key (keep secret)">
                  <input readOnly type="password" value={keys.private} />
                </Field>
                <button
                  onClick={() =>
                    setConfig((old) =>
                      old.replace(
                        /^PrivateKey\s*=.*$/m,
                        `PrivateKey = ${keys.private}`,
                      ),
                    )
                  }
                >
                  Insert private key in editor
                </button>
              </>
            )}
          </Card>
        </div>
        <Card
          title="Tunnel configuration"
          subtitle="Full wg-quick syntax, including multiple peers"
        >
          <Notice>
            Configuration contains private keys. PostUp/PreDown hooks execute as
            root. Saving does not restart an active tunnel; stop and start it to
            activate changes. DNS= requires resolvconf.
          </Notice>
          <Form
            onSubmit={() =>
              act(
                "wireguard.save",
                { name, config },
                "Save this WireGuard configuration? Only use trusted configuration files; hooks run as root when the tunnel starts.",
              )
            }
          >
            <Input
              label="Tunnel name"
              value={name}
              maxLength={15}
              pattern="[a-zA-Z0-9_.-]+"
              required
              onChange={(event) => setName(event.target.value)}
            />
            <Field label="Configuration">
              <textarea
                className="editor"
                rows={20}
                value={config}
                onChange={(event) => setConfig(event.target.value)}
                spellCheck={false}
              />
            </Field>
          </Form>
        </Card>
      </div>
      <Card
        title="Live tunnel status"
        subtitle="Handshakes, transfer counters, endpoints and allowed IPs"
      >
        <ErrorBox error={data?.error} />
        <Code>{data?.status || "No active WireGuard interfaces."}</Code>
      </Card>
    </>
  );
}
