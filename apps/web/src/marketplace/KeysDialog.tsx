import type { ExtensionInfo } from "@apx/protocol";
import { Button, Dialog, Field, Input } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import type { Item } from "../resources/extensionItems.ts";
import { ConnectHead, type LinkState } from "./ConnectHead.tsx";

// Connecting an installed extension to its account: APX joined to the service by dots, the keys it asks for, Connect.
// Keys go to the secret store; a key left empty keeps the one stored.

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function KeysDialog({
  item,
  ext,
  onClose,
  onDone,
}: {
  item: Item;
  ext: ExtensionInfo;
  onClose(): void;
  onDone(): Promise<void>;
}) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, setState] = useState<LinkState>("idle");
  const [error, setError] = useState("");
  const ready = ext.secrets.every((s) => s.set || values[s.name]?.trim());
  const connect = async () => {
    setState("connecting");
    setError("");
    try {
      for (const s of ext.secrets) {
        const v = values[s.name]?.trim();
        if (v) await client.call("extensions.set_secret", { id: ext.id, name: s.name, value: v });
      }
      setState("connected");
      await onDone();
    } catch (e) {
      setState("broken");
      setError(errText(e));
    }
  };
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(o) => !o && state !== "connecting" && onClose()}
      title={t("mkt.connectTitle", { name: item.name })}
      description={t("mkt.connectKeys", { name: item.name })}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={state === "connecting"}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!ready} loading={state === "connecting"} onClick={() => void connect()}>
            {t("mkt.connectAction")}
          </Button>
        </>
      }
    >
      <div className="mkt-connect">
        <ConnectHead item={item} state={state} />
        {ext.secrets.map((s) => (
          <Field
            key={s.name}
            label={s.label}
            hint={
              s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer">
                  {t("ext.getIt")}
                </a>
              ) : undefined
            }
          >
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="off"
                placeholder={s.set ? t("ext.secretSet", { label: s.label }) : s.label}
                value={values[s.name] ?? ""}
                onChange={({ currentTarget: { value } }) => setValues((v) => ({ ...v, [s.name]: value }))}
              />
            )}
          </Field>
        ))}
        {error && <p className="install__error">{error}</p>}
      </div>
    </Dialog>
  );
}
