import type { Result } from "@apx/protocol";
import { Button, Dialog, Field, Icons, Input, SegmentedControl, Spinner } from "@apx/ui";
import { useEffect, useState } from "react";
import { client as api } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { type MessageKey, useT } from "../i18n/index.ts";

type Integration = Result<"integrations.list">["integrations"][number];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** What APX's own sign-in leaves out (scopes Google keeps for verified security reviews). */
const APX_LIMIT: Record<string, MessageKey> = { gmail: "int.apxLimit.gmail", "google-drive": "int.apxLimit.drive" };
/** Google sends the browser back to the core's loopback address, which only this computer reaches. */
const ELSEWHERE = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
/** The code and state in the address Google sent the browser to, or undefined. */
function returned(address: string): { code: string; state: string } | undefined {
  try {
    const q = new URL(address.trim()).searchParams;
    const code = q.get("code");
    const state = q.get("state");
    return code && state ? { code, state } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Opens Google's consent page outside the panel. In the desktop app any window.open goes to the system browser; in
 * a browser the tab is opened on the click itself (a popup blocker lets that one through) and pointed at Google
 * once the core gave the address.
 */
async function openConsent(url: () => Promise<string>): Promise<void> {
  if (window.apxDesktop) {
    window.open(await url(), "_blank");
    return;
  }
  const tab = window.open("about:blank", "_blank");
  try {
    const to = await url();
    if (tab) {
      tab.opener = null;
      tab.location.href = to;
    } else window.location.assign(to);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/**
 * An integration the owner signs in to (Google): "Sign in with Google" with the client APX ships, or with one of their
 * own (its id and secret, and the redirect address to allow in Cloud Console). Google sends the browser back to the
 * panel's /oauth/google page; this dialog closes once the core says it is connected.
 */
export function GoogleSignInForm({
  i,
  title,
  onClose,
  onDone,
}: {
  i: Integration;
  title: string;
  onClose(): void;
  onDone(): Promise<void>;
}) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(i.fields.flatMap((f) => (f.value ? [[f.name, f.value]] : []))),
  );
  const builtin = Boolean(i.oauth?.builtin);
  const [client, setClient] = useState<"apx" | "own">(builtin && i.oauth?.client !== "own" ? "apx" : "own");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [pasted, setPasted] = useState("");
  const ok = client === "apx" || i.fields.every((f) => values[f.name]?.trim() || f.set);

  // While the owner signs in elsewhere, the list says when the core got the code.
  useEffect(() => {
    if (!waiting || i.connected) return;
    const timer = setInterval(async () => {
      try {
        const now = (await api.call("integrations.list", {})).integrations.find((x) => x.id === i.id);
        if (now?.connected) {
          clearInterval(timer);
          await onDone();
        }
      } catch {}
    }, 2000);
    return () => clearInterval(timer);
  }, [waiting, i.connected, i.id, onDone]);

  const signIn = async () => {
    setBusy(true);
    try {
      const sent = client === "apx" ? { client } : { ...values, client };
      await openConsent(async () => (await api.call("integrations.oauth_start", { id: i.id, values: sent })).url);
      setWaiting(true);
    } catch (e) {
      notify(t("error.change", { error: errText(e) }));
    } finally {
      setBusy(false);
    }
  };

  const finishPasted = async () => {
    const got = returned(pasted);
    if (!got) return notify(t("int.pasteBad"));
    setBusy(true);
    try {
      await api.call("integrations.oauth_finish", got);
      await onDone();
    } catch (e) {
      notify(t("error.change", { error: errText(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {waiting ? t("common.close") : t("common.cancel")}
          </Button>
          <Button
            disabled={!ok}
            loading={busy}
            leadingIcon={<Icons.ExternalLink size={14} />}
            onClick={() => void signIn()}
          >
            {i.connected || waiting ? t("int.signInAgain") : t("int.signIn")}
          </Button>
        </>
      }
    >
      <div className="int__form">
        {builtin && (
          <SegmentedControl
            options={[
              { value: "apx", label: t("int.clientApx") },
              { value: "own", label: t("int.clientOwn") },
            ]}
            value={client}
            onValueChange={(v) => setClient(v === "own" ? "own" : "apx")}
          />
        )}
        <p className="int__desc">{t(client === "apx" ? "int.apxNote" : "int.oauthNote")}</p>
        {client === "apx" && APX_LIMIT[i.id] && <p className="int__desc">{t(APX_LIMIT[i.id] as MessageKey)}</p>}
        {client === "own" &&
          i.fields.map((f) => (
            <Field
              key={f.name}
              label={f.label}
              hint={
                f.url ? (
                  <a href={f.url} target="_blank" rel="noreferrer">
                    {t("int.whereToGet")}
                  </a>
                ) : undefined
              }
            >
              {(id) => (
                <Input
                  id={id}
                  type={f.secret ? "password" : "text"}
                  autoComplete="off"
                  placeholder={f.set ? t("int.keepSecret") : f.placeholder}
                  value={values[f.name] ?? ""}
                  onChange={({ currentTarget: { value } }) => setValues((v) => ({ ...v, [f.name]: value }))}
                />
              )}
            </Field>
          ))}
        {client === "own" && i.oauth && (
          <Field label={t("int.redirect")}>
            {(id) => (
              <Input id={id} readOnly value={i.oauth?.redirect_uri ?? ""} onFocus={(e) => e.currentTarget.select()} />
            )}
          </Field>
        )}
        {waiting && (
          <p className="int__desc">
            <Spinner size={12} /> {t("int.waiting")}
          </p>
        )}
        {waiting && ELSEWHERE && (
          <Field label={t("int.pasteLabel")} hint={t("int.pasteHint")}>
            {(id) => (
              <div className="int__paste">
                <Input
                  id={id}
                  autoComplete="off"
                  placeholder="http://127.0.0.1:7440/oauth/google?state=…&code=…"
                  value={pasted}
                  onChange={({ currentTarget: { value } }) => setPasted(value)}
                />
                <Button
                  variant="secondary"
                  disabled={!pasted.trim()}
                  loading={busy}
                  onClick={() => void finishPasted()}
                >
                  {t("int.pasteFinish")}
                </Button>
              </div>
            )}
          </Field>
        )}
      </div>
    </Dialog>
  );
}
