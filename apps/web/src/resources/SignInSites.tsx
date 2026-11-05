import type { SecretInfo } from "@apx/protocol";
import { Button, Dialog, SegmentedControl, Switch, TagInput } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";

type Kind = SecretInfo["sites"][number]["kind"];

/** What the owner typed as a site, as the origin it is kept by ("acme.com/login" → "https://acme.com"). */
function siteOf(typed: string): string | undefined {
  const raw = typed.trim();
  if (!raw) return undefined;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

/** A site as the owner reads it: the host, with the scheme only when it is not https. */
export const siteLabel = (origin: string) => (origin.startsWith("https://") ? origin.slice(8) : origin);

/** Where agents may sign in with a stored value, into which kind of field, or on any site. */
export function SignInSitesDialog(props: {
  name: string;
  project: string | undefined;
  sites: SecretInfo["sites"];
  lastUsed: SecretInfo["last_used"];
  onClose(): void;
  onSaved(): void;
}) {
  const t = useT();
  const [kind, setKind] = useState<Kind>(props.sites[0]?.kind ?? "password");
  const [anySite, setAnySite] = useState(props.sites.some((s) => s.origin === "*"));
  const [typed, setTyped] = useState(props.sites.filter((s) => s.origin !== "*").map((s) => siteLabel(s.origin)));
  const [busy, setBusy] = useState(false);
  const wrong = typed.filter((s) => !siteOf(s));
  const save = async () => {
    setBusy(true);
    const origins = anySite ? ["*"] : [...new Set(typed.map((s) => siteOf(s) as string))];
    try {
      await client.call("secrets.set_sites", {
        name: props.name,
        ...(props.project ? { project: props.project } : {}),
        sites: origins.map((origin) => ({ origin, kind })),
      });
      props.onSaved();
    } catch (e) {
      notify(t("error.save", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && props.onClose()}
      title={t("res.signIn.title", { name: props.name })}
      description={t("res.signIn.lead")}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={wrong.length > 0} loading={busy} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="pform">
        <SegmentedControl
          size="sm"
          label={t("res.signIn.kind")}
          value={kind}
          onValueChange={(v) => setKind(v as Kind)}
          options={[
            { value: "password", label: t("res.signIn.password") },
            { value: "username", label: t("res.signIn.username") },
            { value: "otp", label: t("res.signIn.otp") },
          ]}
        />
        {kind === "otp" && <p className="resd__note">{t("res.signIn.otpHint")}</p>}
        <div className="pform__field">
          <span className="pform__label">{t("res.signIn.anySite")}</span>
          <Switch checked={anySite} onCheckedChange={setAnySite} aria-label={t("res.signIn.anySite")} />
          {anySite && <p className="resd__note">{t("res.signIn.anySiteHint")}</p>}
        </div>
        {!anySite && (
          <div className="pform__field">
            <span className="pform__label">{t("res.signIn.sites")}</span>
            <TagInput
              label={t("res.signIn.sites")}
              value={typed}
              onValueChange={setTyped}
              placeholder="app.acme.com"
              max={12}
            />
          </div>
        )}
        {!anySite && wrong.length > 0 && (
          <p className="resd__note" role="alert">
            {t("res.signIn.wrongSite", { site: wrong[0] ?? "" })}
          </p>
        )}
        {!anySite && !typed.length && <p className="resd__note">{t("res.signIn.none")}</p>}
        {props.lastUsed && (
          <p className="resd__note">
            {t("res.signIn.lastUsed", {
              site: siteLabel(props.lastUsed.origin),
              when: new Date(props.lastUsed.at).toLocaleString(),
            })}
          </p>
        )}
      </div>
    </Dialog>
  );
}
