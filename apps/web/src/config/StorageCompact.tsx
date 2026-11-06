import type { StoreCompaction } from "@apx/protocol";
import { Button, Dialog, Icons, SettingRow } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { size } from "../data/usageModel.ts";
import { useT } from "../i18n/index.ts";

const MB = 1048576;
const human = (bytes: number) => (bytes > 0 && bytes < MB ? "< 1 MB" : size(bytes / MB));

/** What compacting did, in one line: shrunk, trimmed but kept its size, or nothing for lack of disk. */
function outcome(t: ReturnType<typeof useT>, r: StoreCompaction): string {
  if (!r.backup) return t("storage.compact.noRoom");
  if (r.reclaimed === "not_enough_disk") return t("storage.compact.keptSize");
  return t("storage.compact.done", { before: human(r.before_bytes), after: human(r.after_bytes) });
}

/** Settings › Storage: shrinks the file that holds the chats once, after a copy; chats wait while it runs. */
export function StorageCompact({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const r = await client.call("storage.compact", {});
      notify(outcome(t, r), r.backup ? "info" : undefined);
      setAsking(false);
      onDone();
    } catch (e) {
      notify(t("storage.compact.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingRow title={t("storage.compact.title")} description={t("storage.compact.hint")}>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.Minimize2 size={14} />}
          loading={busy}
          onClick={() => setAsking(true)}
        >
          {t("storage.compact.cta")}
        </Button>
      </SettingRow>
      {asking && (
        <Dialog
          open
          title={t("storage.compact.confirmTitle")}
          description={t("storage.compact.confirmBody")}
          onOpenChange={(open) => !open && !busy && setAsking(false)}
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setAsking(false)}>
                {t("common.cancel")}
              </Button>
              <Button loading={busy} onClick={() => void run()}>
                {t("storage.compact.cta")}
              </Button>
            </>
          }
        />
      )}
    </>
  );
}
