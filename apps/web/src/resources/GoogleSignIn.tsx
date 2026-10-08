import type { Result } from "@apx/protocol";
import { Button, Dialog, Field, Icons, Input, Spinner } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";

type Integration = Result<"integrations.list">["integrations"][number];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
 * An integration the owner signs in to (Google): their OAuth client's id and secret, the redirect address to allow
 * in Cloud Console, and "Sign in with Google". Google sends the browser back to the panel's /oauth/google page; this
 * dialog closes once the core says it is connected.
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
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const ok = i.fields.every((f) => values[f.name]?.trim() || f.set);

  // While the owner signs in elsewhere, the list says when the core got the code.
  useEffect(() => {
    if (!waiting || i.connected) return;
    const timer = setInterval(async () => {
      try {
        const now = (await client.call("integrations.list", {})).integrations.find((x) => x.id === i.id);
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
      await openConsent(async () => (await client.call("integrations.oauth_start", { id: i.id, values })).url);
      setWaiting(true);
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
        <p className="int__desc">{t("int.oauthNote")}</p>
        {i.fields.map((f) => (
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
        {i.oauth && (
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
      </div>
    </Dialog>
  );
}
