import type { ExtensionInfo } from "@apx/protocol";
import { Button, Checkbox, Dialog, Icons } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import { usePowerText } from "../resources/ExtensionSummary.tsx";
import { attempt } from "../resources/InstalledExtension.tsx";

// Before an added extension works: what turning it on approves, exactly (where it connects, the keys it keeps, these
// files). A new version that asks for more lists what it adds first.

export function TurnOnDialog({
  e,
  onClose,
  onOn,
}: {
  e: ExtensionInfo;
  onClose(): void;
  /** It is on: the page goes on to its keys or its pairing when it needs them. */
  onOn(): Promise<void>;
}) {
  const t = useT();
  const power = usePowerText();
  const [ok, setOk] = useState({ hosts: false, keys: false, files: false });
  const [busy, setBusy] = useState(false);
  const keys = [...e.secrets.map((s) => s.label), ...e.settings.filter((s) => s.sensitive).map((s) => s.label)];
  const turnOn = async () => {
    setBusy(true);
    const done = await attempt(() => client.call("extensions.enable", { id: e.id, enabled: true }), t);
    setBusy(false);
    if (done) await onOn();
  };
  return (
    <Dialog
      open
      size="md"
      title={t("mkt.turnOnTitle", { name: e.name })}
      description={t("mkt.turnOnLead")}
      closeLabel={t("common.close")}
      onOpenChange={(o) => !o && onClose()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!(ok.hosts && ok.keys && ok.files)}
            loading={busy}
            leadingIcon={<Icons.Power size={14} />}
            onClick={() => void turnOn()}
          >
            {t("mkt.turnOnAction")}
          </Button>
        </>
      }
    >
      <div className="extpage__approve">
        {e.update && e.update.adds.length > 0 && (
          <div className="extupdate">
            <p className="pform__hint">{t("ext.updateAdds", { version: e.version, from: e.update.from })}</p>
            <ul>
              {e.update.adds.map((p) => (
                <li key={`${p.kind}${p.name}`}>{power(p)}</li>
              ))}
            </ul>
          </div>
        )}
        <Checkbox
          checked={ok.hosts}
          onCheckedChange={(v) => setOk((o) => ({ ...o, hosts: v === true }))}
          label={
            e.hosts.length
              ? t(e.owner_host ? "extx.approve.hostsAndYours" : "extx.approve.hosts", { hosts: e.hosts.join(", ") })
              : e.owner_host
                ? t("extx.approve.yourHost")
                : e.runs_code
                  ? t("extx.approve.anyHost")
                  : t("extx.approve.noHosts")
          }
        />
        <Checkbox
          checked={ok.keys}
          onCheckedChange={(v) => setOk((o) => ({ ...o, keys: v === true }))}
          label={keys.length ? t("extx.approve.keys", { keys: keys.join(", ") }) : t("extx.approve.noKeys")}
        />
        <Checkbox
          checked={ok.files}
          onCheckedChange={(v) => setOk((o) => ({ ...o, files: v === true }))}
          label={t("extx.approve.files", { version: e.version })}
        />
        {e.runs_code && (
          <p className="pform__hint">
            <Icons.TriangleAlert size={12} /> {t("ext.runsCode")}
          </p>
        )}
      </div>
    </Dialog>
  );
}
