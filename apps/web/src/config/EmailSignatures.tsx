import type { EmailSignatureEntry, EmailSignatureValue } from "@apx/protocol";
import { Button, SettingRow, Switch, Textarea } from "@apx/ui";
import { useCallback, useEffect, useId, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { usePack, useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

type Target = Pick<EmailSignatureEntry, "transport" | "account" | "sender"> & { label: string };
const keyOf = (e: Target) => JSON.stringify([e.transport, e.account, e.sender]);

export function EmailSignatures({ target }: { target?: Target }) {
  return usePack("signatures") ? (
    <SignatureEditor key={target ? keyOf(target) : "default"} initialTarget={target} />
  ) : null;
}

function SignatureEditor({ initialTarget }: { initialTarget?: Target }) {
  const [target] = useState(initialTarget);
  const t = useT();
  const id = useId();
  const [accountSaved, setAccountSaved] = useState<EmailSignatureEntry | null>(null);
  const [defaultSaved, setDefaultSaved] = useState<EmailSignatureValue | null>(null);
  const [draft, setDraft] = useState({ text: "", html: "", enabled: true });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    setReady(false);
    try {
      let saved: EmailSignatureValue | null;
      if (target) {
        const { signatures } = await client.call("email.signatures_get", {});
        const entry =
          signatures.find(
            (e) =>
              e.transport === target.transport &&
              (e.transport === "gmail"
                ? e.account.toLowerCase() === target.account.toLowerCase()
                : e.account === target.account) &&
              e.sender.toLowerCase() === target.sender.toLowerCase(),
          ) ?? null;
        setAccountSaved(entry);
        saved = entry;
      } else {
        saved = (await client.call("email.signature_default_get", {})).signature;
        setDefaultSaved(saved);
      }
      setDraft({ text: saved?.text ?? "", html: saved?.html ?? "", enabled: saved?.enabled ?? true });
      setReady(true);
    } catch {
      setFailed(true);
    }
  }, [target]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (remove = false) => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const value: EmailSignatureValue = {
        text: draft.text,
        enabled: draft.enabled,
        ...(draft.html.trim() ? { html: draft.html } : {}),
      };
      if (target) {
        const key = { transport: target.transport, account: target.account, sender: target.sender };
        if (remove) {
          if (!accountSaved) return;
          await client.call("email.signature_remove", { key, expected: accountSaved });
          setAccountSaved(null);
        } else {
          const result = await client.call("email.signature_upsert", {
            signature: { ...key, ...value },
            expected: accountSaved,
          });
          setAccountSaved(result.signature);
        }
      } else {
        const result = await client.call("email.signature_default_set", {
          signature: remove ? null : value,
          expected: defaultSaved,
        });
        setDefaultSaved(result.signature);
      }
      if (remove) setDraft({ text: "", html: "", enabled: true });
      notify(t("signature.saved"));
    } catch {
      notify(t("signature.error"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label={t(target ? "signature.title" : "signature.defaultTitle")}>
      <SubHead>{t(target ? "signature.title" : "signature.defaultTitle")}</SubHead>
      <p className="pform__hint">{t(target ? "signature.accountLead" : "signature.defaultLead")}</p>
      {target?.transport === "gmail" && <p className="pform__hint">{t("signature.importHint")}</p>}
      {failed ? (
        <Button variant="secondary" onClick={() => void load()}>
          {t("common.retry")}
        </Button>
      ) : !ready ? (
        <p>{t("signature.loading")}</p>
      ) : (
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
            <label className="pform__label" htmlFor={`${id}-text`}>
              {t("signature.text")}
            </label>
            <Textarea
              id={`${id}-text`}
              value={draft.text}
              maxLength={10_000}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, text: e.currentTarget.value })}
            />
          </div>
          <div className="pform__field">
            <label className="pform__label" htmlFor={`${id}-html`}>
              {t("signature.html")}
            </label>
            <Textarea
              id={`${id}-html`}
              value={draft.html}
              maxLength={30_000}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, html: e.currentTarget.value })}
            />
            <p className="pform__hint">{t("signature.htmlHint")}</p>
          </div>
          <div className="pform__actions">
            <Button disabled={busy || (draft.enabled && !draft.text.trim())} loading={busy} onClick={() => void save()}>
              {t("signature.save")}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !(target ? accountSaved : defaultSaved)}
              onClick={() => void save(true)}
            >
              {t(target ? "signature.useDefault" : "signature.remove")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void load()}>
              {t("signature.reload")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
