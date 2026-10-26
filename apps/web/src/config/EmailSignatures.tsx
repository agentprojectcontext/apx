import type { EmailSignatureEntry } from "@apx/protocol";
import { Button, Select, SettingRow, Switch, Textarea } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { usePack, useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

type Target = Pick<EmailSignatureEntry, "transport" | "account" | "sender"> & { label: string };
const keyOf = (e: Pick<Target, "transport" | "account" | "sender">) =>
  JSON.stringify([e.transport, e.transport === "gmail" ? e.account.toLowerCase() : e.account, e.sender.toLowerCase()]);

export function EmailSignatures() {
  return usePack("signatures") ? <EmailSignaturesBody /> : null;
}

function EmailSignaturesBody() {
  const t = useT();
  const [signatures, setSignatures] = useState<EmailSignatureEntry[]>();
  const [targets, setTargets] = useState<Target[]>([]);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState({ text: "", html: "", enabled: true });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [saved, google, channels] = await Promise.all([
        client.call("email.signatures_get", {}),
        client.call("integrations.list", {}),
        client.call("channels.list", {}),
      ]);
      const gmail = google.integrations.find((i) => i.id === "gmail" && i.connected)?.oauth?.account;
      setSignatures(saved.signatures);
      setTargets([
        ...(gmail ? [{ transport: "gmail" as const, account: gmail, sender: gmail, label: `Gmail · ${gmail}` }] : []),
        ...channels.channels.flatMap((c) =>
          c.type === "email" && c.email
            ? [
                {
                  transport: "smtp" as const,
                  account: c.id,
                  sender: c.email.address,
                  label: `${c.label} · ${c.email.address}`,
                },
              ]
            : [],
        ),
      ]);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const select = (key: string) => {
    setSelected(key);
    const entry = signatures?.find((e) => keyOf(e) === key);
    setDraft({ text: entry?.text ?? "", html: entry?.html ?? "", enabled: entry?.enabled ?? true });
  };
  const target = targets.find((item) => keyOf(item) === selected);
  const save = async (remove = false) => {
    if (!target || !signatures || busy) return;
    setBusy(true);
    try {
      // Refresh the other accounts so an edit in this form does not replace an older snapshot of them.
      const latest = await client.call("email.signatures_get", {});
      const others = latest.signatures.filter((e) => keyOf(e) !== selected);
      const entry: EmailSignatureEntry = {
        transport: target.transport,
        account: target.account,
        sender: target.sender,
        text: draft.text,
        enabled: draft.enabled,
        ...(draft.html.trim() ? { html: draft.html } : {}),
      };
      const result = await client.call("email.signatures_set", { signatures: remove ? others : [...others, entry] });
      setSignatures(result.signatures);
      if (remove) setDraft({ text: "", html: "", enabled: true });
      notify(t("signature.saved"));
    } catch {
      notify(t("signature.error"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SubHead>{t("signature.title")}</SubHead>
      <p className="pform__hint">{t("signature.lead")}</p>
      {failed ? (
        <Button variant="secondary" onClick={() => void load()}>
          {t("common.retry")}
        </Button>
      ) : !signatures ? (
        <p>{t("signature.loading")}</p>
      ) : (
        <>
          <p className="pform__hint">{t("signature.importHint")}</p>
          {!targets.length ? (
            <p>{t("signature.noAccounts")}</p>
          ) : (
            <SettingRow title={t("signature.account")}>
              <Select
                label={t("signature.account")}
                value={selected}
                disabled={busy}
                onValueChange={(value) => select(value ?? "")}
                options={[
                  { value: "", label: t("signature.choose") },
                  ...targets.map((item) => ({ value: keyOf(item), label: item.label })),
                ]}
              />
            </SettingRow>
          )}
          {target && (
            <>
              <SettingRow title={t("signature.enabled")}>
                <Switch
                  checked={draft.enabled}
                  disabled={busy}
                  onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
                  aria-label={t("signature.enabled")}
                />
              </SettingRow>
              <div className="pform__field">
                <label className="pform__label" htmlFor="signature-text">
                  {t("signature.text")}
                </label>
                <Textarea
                  id="signature-text"
                  value={draft.text}
                  maxLength={10_000}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...draft, text: e.currentTarget.value })}
                />
              </div>
              <div className="pform__field">
                <label className="pform__label" htmlFor="signature-html">
                  {t("signature.html")}
                </label>
                <Textarea
                  id="signature-html"
                  value={draft.html}
                  maxLength={30_000}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...draft, html: e.currentTarget.value })}
                />
                <p className="pform__hint">{t("signature.htmlHint")}</p>
              </div>
              <div className="pform__actions">
                <Button disabled={busy || !draft.text.trim()} loading={busy} onClick={() => void save()}>
                  {t("common.save")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !signatures.some((e) => keyOf(e) === selected)}
                  onClick={() => void save(true)}
                >
                  {t("signature.remove")}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
