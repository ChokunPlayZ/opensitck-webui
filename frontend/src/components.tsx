import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { OperationScope, PageOperations, useJobs } from "./jobs";

type Actions = {
  act: (
    action: string,
    params?: Record<string, string>,
    warning?: string,
    scope?: string,
  ) => Promise<void>;
  confirm: (
    title: string,
    detail: string,
    callback: () => Promise<void>,
  ) => void;
  notify: (text: string, error?: boolean) => void;
  openJobs: () => void;
};
const ActionContext = createContext<Actions>(null!);
export const useActions = () => {
  const actions = useContext(ActionContext);
  const scope = useContext(OperationScope);
  return {
    ...actions,
    act: (action: string, params?: Record<string, string>, warning?: string) =>
      actions.act(action, params, warning, scope),
  };
};

export function ActionProvider({
  children,
  onOpenJobs,
}: {
  children: ReactNode;
  onOpenJobs: () => void;
}) {
  const { run } = useJobs();
  const [dialog, setDialog] = useState<{
    title: string;
    detail: string;
    callback: () => Promise<void>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  function notify(text: string, error = false) {
    setNotice({ text, error });
  }
  function confirm(
    title: string,
    detail: string,
    callback: () => Promise<void>,
  ) {
    setDialog({ title, detail, callback });
  }
  async function perform(
    action: string,
    params: Record<string, string>,
    scope: string,
  ) {
    const result = await run(action, params, scope);
    if (!result.job) {
      notify(result.message || "Configuration saved");
    }
  }
  async function act(
    action: string,
    params: Record<string, string> = {},
    warning = "",
    scope = "overview",
  ) {
    if (["diagnostic", "wifi.scan"].includes(action)) {
      try {
        await perform(action, params, scope);
      } catch (error) {
        notify((error as Error).message, true);
      }
      return;
    }
    confirm(
      action.replaceAll(".", " › "),
      warning ||
        "Apply this change to the device? Review the values before continuing.",
      () => perform(action, params, scope),
    );
  }
  return (
    <ActionContext.Provider
      value={{ act, confirm, notify, openJobs: onOpenJobs }}
    >
      {children}
      {notice && (
        <div className={`toast ${notice.error ? "error" : ""}`} role="status">
          {notice.error ? (
            <AlertTriangle size={18} />
          ) : (
            <CheckCircle2 size={18} />
          )}
          <span>{notice.text}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {dialog && (
        <Modal
          title="Confirm device change"
          onClose={() => !busy && setDialog(null)}
        >
          <div className="confirm-icon">
            <AlertTriangle size={25} />
          </div>
          <h3>{dialog.title}</h3>
          <p className="muted preserve">{dialog.detail}</p>
          <div className="form-actions">
            <button disabled={busy} onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await dialog.callback();
                  setDialog(null);
                } catch (error) {
                  notify((error as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Check size={16} />
              )}{" "}
              Confirm change
            </button>
          </div>
        </Modal>
      )}
    </ActionContext.Provider>
  );
}

export function Card({
  title,
  subtitle,
  children,
  actions,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="card-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`badge ${tone}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}
export function Notice({
  children,
  danger = false,
}: {
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <div className={`notice ${danger ? "danger" : ""}`}>
      <AlertTriangle size={17} />
      <div>{children}</div>
    </div>
  );
}
export function ErrorBox({ error }: { error?: string }) {
  return error ? <Notice danger>{error}</Notice> : null;
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle size={20} className="spin" /> Reading device…
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Refresh({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}>
      <RefreshCw size={14} />
      Refresh
    </button>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Input({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input aria-label={label} {...props} />
    </Field>
  );
}
export function Select({
  label,
  options,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: (string | [string, string])[];
}) {
  return (
    <Field label={label}>
      <select aria-label={label} {...props}>
        {options.map((option) => {
          const [value, text] =
            typeof option === "string" ? [option, option] : option;
          return (
            <option key={value} value={value}>
              {text}
            </option>
          );
        })}
      </select>
    </Field>
  );
}
export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value || <span className="muted">Not reported</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
export function Tabs({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (value: string) => void;
  items: string[];
}) {
  return (
    <div className="tabs">
      {items.map((item) => (
        <button
          className={value === item ? "active" : ""}
          key={item}
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Form({
  children,
  onSubmit,
  submit = "Save changes",
}: {
  children: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submit?: string;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(event);
      }}
    >
      {children}
      <div className="form-actions">
        <button className="primary" type="submit">
          {submit}
          <ArrowUpRight size={15} />
        </button>
      </div>
    </form>
  );
}
export function Code({ children }: { children: ReactNode }) {
  return <pre className="code">{children || "No output."}</pre>;
}
export function PageIntro({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="page-intro">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <div className="toolbar">{children}</div>
      </div>
      <PageOperations />
    </>
  );
}
export function LinkButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ChevronRight size={15} />
    </button>
  );
}
