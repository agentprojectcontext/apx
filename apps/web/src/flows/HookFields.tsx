// The webhook step's card: the Flow's two addresses, always shown, and the end of them the owner can rename
// (DECISIONS.md#d-178). Before the first save it shows the address the name gives, kept when the Flow is saved.
import { FLOW_PATH } from "@apx/protocol/flow-path";
import { Button, Dialog, IconButton, Icons, Input } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { usePublicBase } from "./address.ts";
import { hookPath, testPath } from "./steps.tsx";

/** The Flow's address as the editor knows it: saved, or the one it will get, and how to change it. */
export type Address = {
  path: string;
  /** The Flow exists: a new path replaces one services may already call. */
  saved: boolean;
  flowId: string | undefined;
  /** Takes the new path; false when it was not taken. */
  set: (path: string) => Promise<boolean>;
};

const EXAMPLE = '{"id": "1", "data": {…}}';

function Copy({ url }: { url: string }) {
  const t = useT();
  return (
    <IconButton
      label={t("flow.f.copy")}
      icon={<Icons.Copy size={14} />}
      onClick={() =>
        void navigator.clipboard.writeText(url).then(
          () => notify(t("flow.f.copied"), "info"),
          () => undefined,
        )
      }
    />
  );
}

export function HookFields({ address }: { address: Address }) {
  const t = useT();
  const base = usePublicBase();
  const [editing, setEditing] = useState<string>();
  const [asking, setAsking] = useState(false);
  const host = base ?? "";
  const real = `${host}${hookPath(address.path)}`;
  const test = `${host}${testPath(address.path)}`;
  return (
    <>
      <div className="fe-copy">
        <span className="fe-ins__label">{t("flow.f.url")}</span>
        {editing === undefined ? (
          <div className="fe-copy__box">
            <code>
              {host}/flows/
              <button
                type="button"
                className="fe-path"
                aria-label={t("flow.addr.rename")}
                title={t("flow.addr.rename")}
                onClick={() => setEditing(address.path)}
              >
                {address.path}
                <Icons.Pencil size={11} aria-hidden="true" />
              </button>
            </code>
            <Copy url={real} />
          </div>
        ) : (
          <PathEditor
            start={editing}
            flowId={address.flowId}
            onCancel={() => setEditing(undefined)}
            onUse={(path) => {
              if (path === address.path) return setEditing(undefined);
              setEditing(path);
              if (address.saved) setAsking(true);
              else void address.set(path).then((ok) => ok && setEditing(undefined));
            }}
          />
        )}
      </div>
      <div className="fe-copy">
        <span className="fe-ins__label">{t("flow.addr.test")}</span>
        <div className="fe-copy__box">
          <code>{test}</code>
          <Copy url={test} />
        </div>
        <span className="fe-ins__muted">{t("flow.addr.testHint")}</span>
      </div>
      <p className="fe-note">{t("flow.addr.body", { example: EXAMPLE })}</p>
      {!address.saved && <p className="fe-note">{t("flow.addr.kept")}</p>}
      <Button variant="link" size="sm" className="fe-link" onClick={() => go.config("devices")}>
        {t(base === null ? "flow.addr.noHost" : "flow.f.hookNote")}
      </Button>
      <Dialog
        open={asking}
        onOpenChange={setAsking}
        title={t("flow.addr.confirmTitle")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                setAsking(false);
                if (editing) void address.set(editing).then((ok) => ok && setEditing(undefined));
              }}
            >
              {t("flow.addr.confirm")}
            </Button>
          </>
        }
      >
        {t("flow.addr.confirmBody")}
      </Dialog>
    </>
  );
}

/** The end of the address, written and checked against the owner's other Flows as they type. */
function PathEditor(props: {
  start: string;
  flowId: string | undefined;
  onCancel: () => void;
  onUse: (path: string) => void;
}) {
  const t = useT();
  const [path, setPath] = useState(props.start);
  const [problem, setProblem] = useState<"taken" | "invalid" | "reserved" | null>(null);
  useEffect(() => {
    let live = true;
    if (!FLOW_PATH.test(path)) {
      setProblem("invalid");
      return;
    }
    const timer = setTimeout(() => {
      void client.call("flows.path_check", { path, ...(props.flowId ? { flow: props.flowId } : {}) }).then(
        (r) => live && setProblem(r.problem),
        () => live && setProblem(null),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path, props.flowId]);
  const use = () => !problem && props.onUse(path);
  return (
    <div className="fe-pathedit">
      <Input
        aria-label={t("flow.addr.path")}
        className="fe-mono"
        value={path}
        maxLength={64}
        spellCheck={false}
        autoFocus
        onChange={(e) => setPath(e.target.value.toLowerCase())}
        onKeyDown={(e) => {
          if (e.key === "Enter") use();
          if (e.key === "Escape") props.onCancel();
        }}
      />
      {problem && (
        <span className="fe-pathedit__error" role="alert">
          {t(`flow.addr.${problem}`)}
        </span>
      )}
      <span className="fe-pathedit__actions">
        <Button size="sm" variant="secondary" onClick={props.onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" disabled={Boolean(problem)} onClick={use}>
          {t("flow.addr.use")}
        </Button>
      </span>
    </div>
  );
}
