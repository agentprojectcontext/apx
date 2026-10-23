import type { Result } from "@apx/protocol";
import { Button, Checkbox, Dialog, Field, Icons, Input, SegmentedControl, Spinner } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { client as api } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { type MessageKey, useT } from "../i18n/index.ts";

type Integration = Result<"integrations.list">["integrations"][number];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** What APX's own sign-in leaves out (scopes Google keeps for verified security reviews). */
const APX_LIMIT: Record<string, MessageKey> = { gmail: "int.apxLimit.gmail", "google-drive": "int.apxLimit.drive" };
/** Parts whose full use needs the owner's own client: APX's reaches only part of them (no paid security review). */
const OWN_FIRST = new Set(["gmail", "google-drive"]);
/** Creating one's own client in Google Cloud, step by step, each with the console page it happens on. */
const GUIDE: Array<{ text: MessageKey; href: string }> = [
  { text: "int.guide.project", href: "https://console.cloud.google.com/projectcreate" },
  { text: "int.guide.apis", href: "https://console.cloud.google.com/apis/library/gmail.googleapis.com" },
  { text: "int.guide.publish", href: "https://console.cloud.google.com/auth/overview" },
  { text: "int.guide.client", href: "https://console.cloud.google.com/auth/clients/create" },
];
/** The client id and secret in the JSON Cloud Console downloads (`installed`), or undefined. */
function clientOf(text: string): { client_id: string; client_secret: string } | undefined {
  try {
    const data = JSON.parse(text) as { installed?: Record<string, unknown>; web?: Record<string, unknown> };
    const c = data.installed ?? data.web ?? (data as Record<string, unknown>);
    return typeof c.client_id === "string" && typeof c.client_secret === "string"
      ? { client_id: c.client_id, client_secret: c.client_secret }
      : undefined;
  } catch {
    return undefined;
  }
}
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
 * own (its JSON or its id and secret). Calendar starts on APX's; Gmail and Drive on the owner's, which reaches all of
 * them, and one sign-in can connect the other parts with it. Google sends the browser back to the panel's
 * /oauth/google page; this dialog closes once the core says it is connected.
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
  const ownFirst = OWN_FIRST.has(i.id);
  const [client, setClient] = useState<"apx" | "own">(
    !builtin ? "own" : i.connected && i.oauth?.client ? i.oauth.client : ownFirst ? "own" : "apx",
  );
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [pasted, setPasted] = useState("");
  // The other Google parts: those not on the owner's client can join this sign-in, when the owner ticks them.
  const [others, setOthers] = useState<Integration[]>([]);
  const [also, setAlso] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void api
      .call("integrations.list", {})
      .then(({ integrations }) => setOthers(integrations.filter((x) => x.oauth && x.id !== i.id)));
  }, [i.id]);
  const saved = i.fields.every((f) => f.value || f.set);
  const ownUsers = others.filter((x) => x.connected && x.oauth?.client === "own");
  const joinable = others.filter((x) => !(x.connected && x.oauth?.client === "own"));
  const ok = client === "apx" || i.fields.every((f) => values[f.name]?.trim() || f.set);

  const upload = async (picked: File | undefined) => {
    if (!picked) return;
    const got = clientOf(await picked.text());
    if (!got) return notify(t("int.jsonBad"));
    setValues((v) => ({ ...v, ...got }));
  };

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
      const more = client === "own" ? also.filter((id) => joinable.some((x) => x.id === id)) : [];
      await openConsent(
        async () =>
          (
            await api.call("integrations.oauth_start", {
              id: i.id,
              values: sent,
              ...(more.length ? { also: more } : {}),
            })
          ).url,
      );
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
            options={
              ownFirst
                ? [
                    { value: "own", label: t("int.clientOwn") },
                    { value: "apx", label: t("int.clientApxLimited") },
                  ]
                : [
                    { value: "apx", label: t("int.clientApx") },
                    { value: "own", label: t("int.clientOwn") },
                  ]
            }
            value={client}
            onValueChange={(v) => setClient(v === "own" ? "own" : "apx")}
          />
        )}
        {client === "apx" && <p className="int__desc">{t("int.apxNote")}</p>}
        {client === "apx" && APX_LIMIT[i.id] && <p className="int__desc">{t(APX_LIMIT[i.id] as MessageKey)}</p>}
        {client === "own" &&
          (saved ? (
            <p className="int__desc">
              {ownUsers.length
                ? t("int.ownSavedFor", { names: ownUsers.map((x) => x.label).join(", ") })
                : t("int.ownSaved")}
            </p>
          ) : (
            <>
              <p className="int__desc">{t("int.ownNote")}</p>
              <ol className="int__guide">
                {GUIDE.map((step) => (
                  <li key={step.text}>
                    {t(step.text)}{" "}
                    <a href={step.href} target="_blank" rel="noreferrer">
                      {t("int.guide.open")}
                    </a>
                  </li>
                ))}
              </ol>
            </>
          ))}
        {client === "own" && (
          <>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => void upload(e.currentTarget.files?.[0])}
            />
            <Button variant="secondary" leadingIcon={<Icons.Upload size={14} />} onClick={() => file.current?.click()}>
              {t("int.jsonUpload")}
            </Button>
          </>
        )}
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
          <Field label={t("int.redirect")} hint={t("int.redirectHint")}>
            {(id) => (
              <Input id={id} readOnly value={i.oauth?.redirect_uri ?? ""} onFocus={(e) => e.currentTarget.select()} />
            )}
          </Field>
        )}
        {client === "own" && joinable.length > 0 && (
          <Field label={t("int.alsoLabel")}>
            {() => (
              <div className="int__also">
                {joinable.map((x) => (
                  <Checkbox
                    key={x.id}
                    label={x.label}
                    checked={also.includes(x.id)}
                    onCheckedChange={(on) => setAlso((a) => (on ? [...a, x.id] : a.filter((y) => y !== x.id)))}
                  />
                ))}
              </div>
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
