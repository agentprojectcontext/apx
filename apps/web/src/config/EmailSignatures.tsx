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

export function EmailSignatures({ target }: { target?: Target }) {
  return usePack("signatures") ? (
    <EmailSignaturesBody key={target ? keyOf(target) : "accounts"} fixedTarget={target} />
  ) : null;
}

function EmailSignaturesBody({ fixedTarget: initialTarget }: { fixedTarget?: Target }) {
  const [fixedTarget] = useState(initialTarget);
  const t = useT();
  const [signatures, setSignatures] = useState<EmailSignatureEntry[]>();
  const [targets, setTargets] = useState<Target[]>([]);
  const [selected, setSelected] = useState(fixedTarget ? keyOf(fixedTarget) : "");
  const [draft, setDraft] = useState({ text: "", html: "", enabled: true });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      if (fixedTarget) {
        const saved = await client.call("email.signatures_get", {});
        setSignatures(saved.signatures);
        setTargets([fixedTarget]);
        const entry = saved.signatures.find((e) => keyOf(e) === keyOf(fixedTarget));
        setDraft({ text: entry?.text ?? "", html: entry?.html ?? "", enabled: entry?.enabled ?? true });
        return;
      }
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
  }, [fixedTarget]);
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
      const expected = signatures.find((e) => keyOf(e) === selected) ?? null;
      const entry: EmailSignatureEntry = {
        transport: target.transport,
        account: target.account,
        sender: target.sender,
        text: draft.text,
        enabled: draft.enabled,
        ...(draft.html.trim() ? { html: draft.html } : {}),
      };
      if (remove) {
        if (!expected) return;
        await client.call("email.signature_remove", {
          key: { transport: target.transport, account: target.account, sender: target.sender },
          expected,
        });
      } else {
        await client.call("email.signature_upsert", { signature: entry, expected });
      }
      const result = await client.call("email.signatures_get", {});
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
          {fixedTarget ? null : !targets.length ? (
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
                  {t("signature.save")}
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
