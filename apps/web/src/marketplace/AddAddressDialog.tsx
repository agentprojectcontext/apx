import type { McpServerStatus } from "@apx/protocol";
import { Button, Dialog, Field, Input } from "@apx/ui";
import { useState } from "react";
import { setMcp } from "../data/resources.ts";
import { useT } from "../i18n/index.ts";
import { openExtensionInstall } from "../resources/extensionInstall.ts";
import { nameFor } from "./itemText.ts";

// Add → From an address: an MCP server someone gave as a link becomes one of the owner's own extensions (an .apxext
// at an address goes to the install dialog instead). Its page then shows whether it answered and what it brings.

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/;

export function AddAddressDialog({
  servers,
  onClose,
  onAdded,
}: {
  servers: McpServerStatus[];
  onClose(): void;
  onAdded(name: string): Promise<void>;
}) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const typed = url.trim();
  const valid = /^https?:\/\/[^/\s]+/.test(typed);
  const shown =
    name ||
    (valid
      ? nameFor(
          typed,
          servers.map((s) => s.name),
        )
      : "");
  const add = async () => {
    if (!valid) return;
    if (/\.apxext(\?.*)?$/i.test(typed)) {
      onClose();
      openExtensionInstall({ url: typed });
      return;
    }
    setBusy(true);
    const saved = await setMcp(shown, { url: typed, enabled: true });
    setBusy(false);
    if (saved) await onAdded(shown);
  };
  return (
    <Dialog
      open
      size="md"
      title={t("mkt.addAddressTitle")}
      description={t("mkt.addAddressLead")}
      closeLabel={t("common.close")}
      onOpenChange={(o) => !o && onClose()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!valid || !NAME.test(shown)} loading={busy} onClick={() => void add()}>
            {t("mkt.step.add")}
          </Button>
        </>
      }
    >
      <div className="pform">
        <Field label={t("mkt.addressLabel")} hint={t("mkt.addressHint")}>
          {(id) => (
            <Input
              id={id}
              inputMode="url"
              autoComplete="off"
              placeholder="https://mcp.example.com/mcp"
              value={url}
              onChange={(e) => setUrl(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
            />
          )}
        </Field>
        {valid && !/\.apxext(\?.*)?$/i.test(typed) && (
          <Field label={t("mkt.nameLabel")} hint={t("mkt.nameHint")}>
            {(id) => (
              <Input id={id} autoComplete="off" value={shown} onChange={(e) => setName(e.currentTarget.value)} />
            )}
          </Field>
        )}
      </div>
    </Dialog>
  );
}
