import { useRef, useState } from "react";
import {
  ArrowUp,
  Download,
  File,
  Folder,
  FolderPlus,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { api, bytes, encode, upload, useData } from "../api";
import {
  Card,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  Notice,
  PageIntro,
  Refresh,
  useActions,
} from "../components";

export function TextEditor({
  path,
  initial,
  onClose,
}: {
  path: string;
  initial: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState(initial);
  const { confirm, notify } = useActions();
  return (
    <Modal wide title={path} onClose={onClose}>
      <Notice>
        Administrator-level editor. The previous file is saved as .webui.bak.
        Incorrect system configuration can prevent networking or boot. Changes
        are not automatically reloaded.
      </Notice>
      <Field label="File contents">
        <textarea
          className="editor"
          rows={25}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          spellCheck={false}
        />
      </Field>
      <div className="form-actions">
        <button onClick={onClose}>Close</button>
        <button
          className="primary"
          onClick={() =>
            confirm(
              "Save system file",
              `Replace ${path}? A backup will be created if the file exists.`,
              async () => {
                await api("file", { path, content, confirm: true });
                notify(
                  "File saved. Reload the relevant service to activate changes.",
                );
                onClose();
              },
            )
          }
        >
          Save file
        </button>
      </div>
    </Modal>
  );
}

export default function Files() {
  const [path, setPath] = useState("/etc"),
    [pathInput, setPathInput] = useState("/etc");
  const { data, error, reload } = useData(`files?path=${encode(path)}`);
  const { act, notify } = useActions();
  const [editing, setEditing] = useState<{
      path: string;
      content: string;
    } | null>(null),
    [newDialog, setNewDialog] = useState(""),
    [filename, setFilename] = useState(""),
    [rename, setRename] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const join = (name: string) => `${path === "/" ? "" : path}/${name}`;
  function navigate(next: string) {
    setPath(next);
    setPathInput(next);
  }
  async function edit(target: string) {
    try {
      const file = await api(`file?path=${encode(target)}`);
      setEditing(file);
    } catch (error) {
      notify((error as Error).message, true);
    }
  }
  return (
    <>
      <PageIntro
        eyebrow="DEVICE STORAGE"
        title="Files & configuration"
        description="Browse, edit, upload and download files directly on the stick."
      >
        <Refresh onClick={reload} />
        <button onClick={() => fileInput.current?.click()}>
          <Upload size={14} />
          Upload
        </button>
        <button
          onClick={() => {
            setNewDialog("file");
            setFilename("");
          }}
        >
          <File size={14} />
          New file
        </button>
        <button
          onClick={() => {
            setNewDialog("folder");
            setFilename("");
          }}
        >
          <FolderPlus size={14} />
          New folder
        </button>
      </PageIntro>
      <ErrorBox error={error} />
      <Card>
        <form
          className="path-bar"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(pathInput);
          }}
        >
          <button
            type="button"
            aria-label="Parent directory"
            onClick={() =>
              navigate(path.split("/").slice(0, -1).join("/") || "/")
            }
          >
            <ArrowUp size={16} />
          </button>
          <input
            aria-label="Directory path"
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
          />
          <button type="submit">Go</button>
        </form>
        {!data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Permissions</th>
                  <th>Modified</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.files?.map((file: any) => (
                  <tr key={file.name}>
                    <td>
                      <button
                        className="file-name"
                        onClick={() =>
                          file.directory
                            ? navigate(join(file.name))
                            : edit(join(file.name))
                        }
                      >
                        {file.directory ? (
                          <Folder size={17} />
                        ) : (
                          <File size={17} />
                        )}
                        <span>
                          {file.name}
                          {file.symlink ? " ↗" : ""}
                        </span>
                      </button>
                    </td>
                    <td>{file.directory ? "—" : bytes(file.size)}</td>
                    <td className="mono">{file.mode}</td>
                    <td>{new Date(file.modified).toLocaleString()}</td>
                    <td>
                      <div className="inline-actions">
                        {!file.directory && (
                          <>
                            <button
                              title="Edit file"
                              className="icon-button"
                              onClick={() => edit(join(file.name))}
                            >
                              <Pencil size={15} />
                            </button>
                            <a
                              title="Download file"
                              className="button icon-button"
                              href={`/api/download?path=${encode(join(file.name))}`}
                            >
                              <Download size={15} />
                            </a>
                          </>
                        )}
                        <button
                          onClick={() => {
                            setRename(join(file.name));
                            setFilename(file.name);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          title="Delete file or empty directory"
                          className="icon-button danger-text"
                          onClick={() =>
                            act(
                              "file.delete",
                              { path: join(file.name) },
                              `Delete ${join(file.name)}? This cannot be undone. Directories must be empty.`,
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
        )}
      </Card>
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            if (file.size > 16 * 1024 ** 2)
              throw new Error(
                "Upload limit is 16 MiB. Use scp for larger files.",
              );
            await upload(`upload?path=${encode(join(file.name))}`, file);
            notify("File uploaded");
            reload();
          } catch (error) {
            notify((error as Error).message, true);
          }
          event.target.value = "";
        }}
      />
      {editing && (
        <TextEditor
          path={editing.path}
          initial={editing.content}
          onClose={() => {
            setEditing(null);
            reload();
          }}
        />
      )}{" "}
      {(newDialog || rename) && (
        <Modal
          title={rename ? "Rename item" : `New ${newDialog}`}
          onClose={() => {
            setNewDialog("");
            setRename("");
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                filename.includes("/") ||
                [".", "..", ""].includes(filename)
              ) {
                notify("Use a filename without slashes", true);
                return;
              }
              if (rename)
                act("file.rename", {
                  path: rename,
                  destination: join(filename),
                });
              else if (newDialog === "folder")
                act("file.mkdir", { path: join(filename) });
              else setEditing({ path: join(filename), content: "" });
              setNewDialog("");
              setRename("");
            }}
          >
            <Input
              label="Name"
              autoFocus
              required
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
            />
            <div className="form-actions">
              <button className="primary">Continue</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
