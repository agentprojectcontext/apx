// The webhook step's card: the Flow's address as one line whose end the owner edits in place (DECISIONS.md#d-178),
// production or test, one copy; the methods it takes and the key its callers send (DECISIONS.md#d-182).
import { FLOW_PATH } from "@apx/protocol/flow-path";
import { Button, Dialog, IconButton, Icons, Input, SegmentedControl } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { usePublicBase } from "./address.ts";
import type { FlowNode } from "./steps.tsx";

/** The Flow's address as the editor knows it: saved, or the one it will get, and how to change it. */
export type Address = {
  path: string;
  /** The Flow exists: a new path replaces one services may already call. */
  saved: boolean;
  flowId: string | undefined;
  /** Takes the new path; false when it was not taken. */
  set: (path: string) => Promise<boolean>;
};

type Hook = Extract<FlowNode, { kind: "webhook" }>;
type Problem = "taken" | "invalid" | "reserved";
const METHODS = { POST: ["POST"], GET: ["GET"], both: ["POST", "GET"] } as const;

const copy = (text: string, done: string) =>
  void navigator.clipboard.writeText(text).then(
    () => notify(done, "info"),
    () => undefined,
  );

export function HookFields({ address, n, update }: { address: Address; n: Hook; update: (n: Hook) => void }) {
  const t = useT();
  const methods = n.methods ?? ["POST"];
  const which = methods.length === 2 ? "both" : (methods[0] ?? "POST");
  return (
    <>
      <HookUrl address={address} />
      <div className="trg-row">
        <span className="fe-ins__label">{t("flow.hook.methods")}</span>
        <SegmentedControl
          size="sm"
          label={t("flow.hook.methods")}
          value={which}
          onValueChange={(v) => {
            const { methods: _, ...rest } = n;
            update(v === "POST" ? rest : { ...rest, methods: [...METHODS[v as keyof typeof METHODS]] });
          }}
          options={[
            { value: "POST", label: "POST" },
            { value: "GET", label: "GET" },
            { value: "both", label: t("flow.hook.both") },
          ]}
        />
        <p className="fe-note">{t(`flow.hook.methodsHint.${which}`)}</p>
      </div>
      <HookKey flowId={address.saved ? address.flowId : undefined} />
    </>
  );
}

/** The address, production or test, in one line: only its end can be written, right there. */
function HookUrl({ address }: { address: Address }) {
  const t = useT();
  const base = usePublicBase();
  const [test, setTest] = useState(false);
  const [draft, setDraft] = useState<string>();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [asking, setAsking] = useState<string>();
  const editable = useRef<HTMLSpanElement>(null);
  const prefix = `${base ?? ""}/flows/${test ? "test/" : ""}`;
  // The text is the element's own while the owner writes; otherwise it follows the address.
  useEffect(() => {
    const el = editable.current;
    if (el && draft === undefined && el.textContent !== address.path) el.textContent = address.path;
  }, [address.path, draft]);
  useEffect(() => {
    if (draft === undefined || draft === address.path) return setProblem(null);
    if (!FLOW_PATH.test(draft)) return setProblem("invalid");
    let live = true;
    const timer = setTimeout(() => {
      void client.call("flows.path_check", { path: draft, ...(address.flowId ? { flow: address.flowId } : {}) }).then(
        (r) => live && setProblem(r.problem),
        () => live && setProblem(null),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [draft, address.path, address.flowId]);
  const reset = () => {
    if (editable.current) editable.current.textContent = address.path;
    setDraft(undefined);
  };
  const take = (path: string) =>
    void address.set(path).then((ok) => {
      if (ok) setDraft(undefined);
    });
  const commit = () => {
    if (draft === undefined || draft === address.path) return reset();
    if (problem) return;
    if (address.saved) setAsking(draft);
    else take(draft);
  };
  return (
    <div className="trg-url">
      <div className="trg-url__head">
        <span className="fe-ins__label">{t("flow.hook.address")}</span>
        <SegmentedControl
          size="sm"
          label={t("flow.hook.which")}
          value={test ? "test" : "prod"}
          onValueChange={(v) => setTest(v === "test")}
          options={[
            { value: "prod", label: t("flow.hook.prod") },
            { value: "test", label: t("flow.hook.test") },
          ]}
        />
      </div>
      <div className={problem ? "trg-url__box is-invalid" : "trg-url__box"}>
        <code className="trg-url__text">
          <span className="trg-url__fixed">{prefix}</span>
          {/* biome-ignore lint/a11y/useSemanticElements: the end of the address wraps with the rest of it, as an input can't */}
          <span
            ref={editable}
            className="trg-url__path"
            role="textbox"
            tabIndex={0}
            aria-label={t("flow.addr.path")}
            aria-invalid={Boolean(problem) || undefined}
            contentEditable="plaintext-only"
            spellCheck={false}
            suppressContentEditableWarning
            onInput={(e) => setDraft((e.currentTarget.textContent ?? "").toLowerCase())}
            onFocus={(e) => {
              // The whole end is selected: typing replaces it, a click inside places the caret.
              const range = document.createRange();
              range.selectNodeContents(e.currentTarget);
              const selection = window.getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                // Cancels the edit only; the card stays open.
                e.stopPropagation();
                reset();
                e.currentTarget.blur();
              }
            }}
          />
        </code>
        <IconButton
          size="sm"
          label={t(test ? "flow.hook.copyTest" : "flow.hook.copyProd")}
          icon={<Icons.Copy size={14} />}
          disabled={!base}
          onClick={() => copy(`${prefix}${address.path}`, t("flow.f.copied"))}
        />
      </div>
      {problem ? (
        <span className="fe-next__error" role="alert">
          {t(`flow.addr.${problem}`)}
        </span>
      ) : (
        <span className="fe-note">
          {t(test ? "flow.addr.testHint" : address.saved ? "flow.hook.editHint" : "flow.addr.kept")}
        </span>
      )}
      {base === null && (
        <Button variant="link" size="sm" className="fe-link" onClick={() => go.config("devices")}>
          {t("flow.addr.noHost")}
        </Button>
      )}
      <Dialog
        open={asking !== undefined}
        onOpenChange={(open) => {
          if (open) return;
          setAsking(undefined);
          reset();
        }}
        title={t("flow.addr.confirmTitle")}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setAsking(undefined);
                reset();
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (asking) take(asking);
                setAsking(undefined);
              }}
            >
              {t("flow.addr.confirm")}
            </Button>
          </>
        }
      >
        {t("flow.addr.confirmBody")}
      </Dialog>
    </div>
  );
}

/** The key callers send: hidden until asked, copied, replaced by a new one or the owner's own after a warning. */
function HookKey({ flowId }: { flowId: string | undefined }) {
  const t = useT();
  const [key, setKey] = useState<{ token: string | null }>();
  const [shown, setShown] = useState(false);
  const [own, setOwn] = useState<string>();
  const [asking, setAsking] = useState<"new" | "own">();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!flowId) return;
    let live = true;
    void client.call("flows.token", { flow: flowId }).then(
      (r) => live && setKey(r),
      () => live && setKey({ token: null }),
    );
    return () => {
      live = false;
    };
  }, [flowId]);
  const replace = async (token?: string) => {
    if (!flowId) return;
    setBusy(true);
    try {
      setKey(await client.call("flows.token_rotate", { flow: flowId, ...(token ? { token } : {}) }));
      setOwn(undefined);
      setShown(true);
      notify(t("flow.key.changed"), "info");
    } catch {
      notify(t("flow.key.failed"));
    } finally {
      setBusy(false);
      setAsking(undefined);
    }
  };
  const token = key?.token;
  const ownValid = own !== undefined && /^[A-Za-z0-9._~-]{24,200}$/.test(own);
  return (
    <div className="trg-row">
      <span className="fe-ins__label">{t("flow.key.label")}</span>
      {!flowId ? (
        <p className="fe-note">{t("flow.key.afterSave")}</p>
      ) : own !== undefined ? (
        <>
          <Input
            size="sm"
            className="fe-mono"
            aria-label={t("flow.key.own")}
            placeholder={t("flow.key.ownPlaceholder")}
            value={own}
            maxLength={200}
            spellCheck={false}
            autoFocus
            invalid={own.length > 0 && !ownValid}
            onChange={(e) => setOwn(e.target.value.trim())}
          />
          <span className="fe-note">{t("flow.key.ownHint")}</span>
          <span className="trg-row__actions">
            <Button size="sm" variant="secondary" onClick={() => setOwn(undefined)}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={!ownValid || busy}
              onClick={() => (token ? setAsking("own") : void replace(own))}
            >
              {t("flow.key.useOwn")}
            </Button>
          </span>
        </>
      ) : token ? (
        <>
          <div className="trg-url__box">
            <code className="trg-url__text trg-key">{shown ? token : `${"•".repeat(16)}${token.slice(-4)}`}</code>
            <IconButton
              size="sm"
              label={t(shown ? "flow.key.hide" : "flow.key.show")}
              icon={shown ? <Icons.EyeOff size={14} /> : <Icons.Eye size={14} />}
              onClick={() => setShown(!shown)}
            />
            <IconButton
              size="sm"
              label={t("flow.key.copy")}
              icon={<Icons.Copy size={14} />}
              onClick={() => copy(token, t("flow.key.copied"))}
            />
          </div>
          <span className="fe-note">{t("flow.key.hint")}</span>
          <span className="trg-row__actions">
            <Button size="sm" variant="ghost" onClick={() => setOwn("")}>
              <Icons.Pencil size={14} /> {t("flow.key.writeOwn")}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setAsking("new")}>
              <Icons.RefreshCw size={14} /> {t("flow.key.rotate")}
            </Button>
          </span>
        </>
      ) : key ? (
        <>
          <p className="fe-note">{t("flow.key.none")}</p>
          <span className="trg-row__actions">
            <Button size="sm" variant="ghost" onClick={() => setOwn("")}>
              {t("flow.key.writeOwn")}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void replace()}>
              <Icons.KeyRound size={14} /> {t("flow.key.create")}
            </Button>
          </span>
        </>
      ) : null}
      <Dialog
        open={asking !== undefined}
        onOpenChange={(open) => !open && setAsking(undefined)}
        title={t("flow.key.confirmTitle")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAsking(undefined)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void replace(asking === "own" ? own : undefined)}>
              {t("flow.key.confirm")}
            </Button>
          </>
        }
      >
        {t("flow.key.confirmBody")}
      </Dialog>
    </div>
  );
}
