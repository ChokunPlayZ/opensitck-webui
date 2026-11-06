import { useState } from "react";
import { useData } from "../api";
import {
  Badge,
  Card,
  ErrorBox,
  Form,
  Input,
  KV,
  Loading,
  Modal,
  Notice,
  PageIntro,
  Refresh,
  Select,
  useActions,
} from "../components";

interface LinuxAccount {
  username: string;
  uid: number;
  name: string;
  home: string;
  shell: string;
  groups: string[];
  status: string;
  sudo: boolean;
  editable: boolean;
}
interface UsersData {
  users: LinuxAccount[];
  currentUser: string;
  statusError: string;
}

export default function Users() {
  const { data, error, reload } = useData<UsersData>("users", 10000);
  const { act } = useActions();
  const [showSystem, setShowSystem] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sudo, setSudo] = useState("false");
  const selected = data?.users.find((user) => user.username === editing);
  const accounts =
    data?.users.filter(
      (user) => showSystem || user.editable || user.uid === 0,
    ) || [];
  return (
    <>
      <PageIntro
        eyebrow="ADMINISTRATION"
        title="User manager"
        description="Manage the real Debian accounts used by Linux, SSH and this console."
      >
        <Refresh onClick={reload} />
      </PageIntro>
      <ErrorBox error={error} />
      <Notice>
        Console access grants root-level management. Only UID 0 accounts or
        accounts authorized by sudo for /bin/sh can sign in. Adding someone to
        the sudo group normally grants full administration; it is not a limited
        web-only role.
      </Notice>
      <Card
        title="Local accounts"
        subtitle="Root and service accounts are protected from changes here"
        actions={
          <button onClick={() => setShowSystem(!showSystem)}>
            {showSystem ? "Hide system accounts" : "Show system accounts"}
          </button>
        }
      >
        <ErrorBox
          error={
            data?.statusError
              ? `Password status unavailable: ${data.statusError}`
              : ""
          }
        />
        {!data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Password</th>
                  <th>Privileges</th>
                  <th>Groups</th>
                  <th>Control</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((user) => (
                  <tr key={user.username}>
                    <td>
                      <strong>
                        {user.username}
                        {user.username === data.currentUser ? " (you)" : ""}
                      </strong>
                      <small>
                        UID {user.uid} · {user.shell}
                      </small>
                    </td>
                    <td>
                      <Badge
                        tone={
                          user.status === "P"
                            ? "green"
                            : user.status === "L"
                              ? "amber"
                              : "neutral"
                        }
                      >
                        {(
                          {
                            P: "Password set",
                            L: "Password locked",
                            NP: "No password",
                          } as Record<string, string>
                        )[user.status] || "Unknown"}
                      </Badge>
                    </td>
                    <td>
                      {user.uid === 0
                        ? "Root"
                        : user.sudo
                          ? "Sudo group"
                          : "Standard"}
                    </td>
                    <td>{user.groups.join(", ") || "—"}</td>
                    <td>
                      <button
                        disabled={!user.editable}
                        onClick={() => setEditing(user.username)}
                      >
                        {user.editable ? "Manage" : "Protected"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card
        title="Create Debian account"
        subtitle="Creates a home directory and a Bash login; existing accounts are never overwritten"
      >
        <Form
          submit="Create account"
          onSubmit={() => {
            act(
              "user.create",
              { user: username, password, sudo },
              `Create Debian account “${username}” with a home directory? ${sudo === "true" ? "Sudo group membership grants full device administration and console access under the standard Debian policy." : "This is a standard Linux/SSH account, without console administration by default."}`,
            );
            setPassword("");
          }}
        >
          <div className="form-grid">
            <Input
              label="New username"
              value={username}
              required
              maxLength={32}
              pattern="[a-z_][a-z0-9_-]{0,31}"
              autoComplete="off"
              onChange={(event) => setUsername(event.target.value)}
            />
            <Input
              label="Initial password"
              type="password"
              value={password}
              required
              minLength={8}
              maxLength={512}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
            <Select
              label="Account privileges"
              options={[
                ["false", "Standard Linux / SSH account"],
                ["true", "Administrator (sudo group)"],
              ]}
              value={sudo}
              onChange={(event) => setSudo(event.target.value)}
            />
          </div>
        </Form>
      </Card>
      {selected && (
        <AccountEditor
          key={selected.username}
          user={selected}
          own={selected.username === data?.currentUser}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function AccountEditor({
  user,
  own,
  onClose,
}: {
  user: LinuxAccount;
  own: boolean;
  onClose: () => void;
}) {
  const { act } = useActions();
  const [password, setPassword] = useState("");
  return (
    <Modal title={`Manage ${user.username}`} onClose={onClose}>
      <KV
        rows={[
          ["Home directory", user.home],
          ["Login shell", user.shell],
          ["Groups", user.groups.join(", ")],
        ]}
      />
      <Notice>
        Password, lock, delete and sudo changes revoke all console sessions
        after success. Password locking does not disable SSH keys or terminate
        running SSH sessions. Sudo group removal does not remove custom sudoers
        permissions.
      </Notice>
      {own && (
        <p className="muted">
          You cannot lock, delete or remove sudo membership from your own
          signed-in account.
        </p>
      )}
      <Form
        submit="Set password"
        onSubmit={() => {
          act(
            "user.password",
            { user: user.username, password },
            `Change the real Debian password for ${user.username}? This also changes SSH credentials and signs all console sessions out.`,
          );
          setPassword("");
        }}
      >
        <Input
          label="New account password"
          type="password"
          required
          minLength={8}
          maxLength={512}
          value={password}
          autoComplete="new-password"
          onChange={(event) => setPassword(event.target.value)}
        />
      </Form>
      <h3 className="section-label">Account access</h3>
      <div className="inline-actions wrap">
        <button
          disabled={own || user.status === "L"}
          onClick={() =>
            act(
              "user.lock",
              { user: user.username },
              `Lock password authentication for ${user.username}? SSH keys and running sessions are not disabled. All console sessions will be revoked.`,
            )
          }
        >
          Lock password
        </button>
        <button
          disabled={user.status !== "L"}
          onClick={() =>
            act(
              "user.unlock",
              { user: user.username },
              `Unlock the existing Debian password for ${user.username}? This does not reset the password or clear account expiration.`,
            )
          }
        >
          Unlock password
        </button>
        <button
          disabled={own && user.sudo}
          onClick={() =>
            act(
              "user.sudo",
              { user: user.username, enabled: String(!user.sudo) },
              user.sudo
                ? `Remove ${user.username} from the sudo group? Custom sudoers permissions remain unchanged. All console sessions will be revoked.`
                : `Add ${user.username} to the sudo group? Under the standard Debian policy this grants full root administration, SSH sudo and console access.`,
            )
          }
        >
          {user.sudo ? "Remove sudo membership" : "Grant sudo membership"}
        </button>
      </div>
      <h3 className="section-label">Remove account</h3>
      <p className="muted">
        The home directory and owned files are kept. Debian refuses deletion if
        the account has running processes.
      </p>
      <button
        className="danger-text"
        disabled={own}
        onClick={() =>
          act(
            "user.delete",
            { user: user.username },
            `Delete Debian account ${user.username}? Its home directory and files will be preserved. All console sessions will be revoked.`,
          )
        }
      >
        Delete account (keep files)
      </button>
    </Modal>
  );
}
