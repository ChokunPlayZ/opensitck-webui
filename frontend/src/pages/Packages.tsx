import { useState } from "react";
import { Package, Search } from "lucide-react";
import { useData } from "../api";
import {
  Card,
  ErrorBox,
  Form,
  Input,
  Loading,
  Notice,
  PageIntro,
  Refresh,
  useActions,
} from "../components";

export default function Packages() {
  const { data, error, reload } = useData("packages");
  const { act } = useActions();
  const [search, setSearch] = useState(""),
    [names, setNames] = useState("");
  const packages =
    data?.packages?.filter((entry: string[]) => entry[0].includes(search)) ||
    [];
  return (
    <>
      <PageIntro
        eyebrow="SOFTWARE"
        title="Packages"
        description="Manage Debian software with the native APT package manager."
      >
        <Refresh onClick={reload} />
        <button onClick={() => act("package.update")}>Refresh APT index</button>
        <button
          onClick={() =>
            act(
              "package.upgrade",
              {},
              "Upgrade installed packages? This can take several minutes, consume storage/data, and restart services. Back up first. Existing configuration files are kept.",
            )
          }
        >
          Upgrade system
        </button>
      </PageIntro>
      <ErrorBox error={error} />
      <Notice>
        Package operations require internet on the stick. This device has
        limited RAM and eMMC storage. Avoid installing large stacks. Progress
        and errors appear here; do not unplug while dpkg is running.
      </Notice>
      <Card title="Install software" actions={<Package size={18} />}>
        <Form
          submit="Install packages"
          onSubmit={() => act("package.install", { packages: names })}
        >
          <Input
            label="Package names (space-separated)"
            placeholder="tcpdump traceroute nano"
            required
            value={names}
            onChange={(event) => setNames(event.target.value)}
          />
        </Form>
      </Card>
      <Card
        title="Installed packages"
        subtitle={`${data?.packages?.length || 0} installed`}
      >
        <div className="search-input">
          <Search size={16} />
          <input
            aria-label="Search packages"
            placeholder="Filter packages…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {!data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Version</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((entry: string[]) => (
                  <tr key={entry[0]}>
                    <td className="mono">{entry[0]}</td>
                    <td>{entry[1]}</td>
                    <td>
                      <button
                        className="danger-text"
                        onClick={() =>
                          act(
                            "package.remove",
                            { packages: entry[0] },
                            `Remove ${entry[0]} and any dependent packages? Review APT output carefully.`,
                          )
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
