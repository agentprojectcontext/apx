import type { Device } from "@apx/protocol";
import { Select } from "@apx/ui";
import { useEffect, useState } from "react";
import { loadChannels, saveNotices, useChannels } from "../data/channels.ts";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";

/**
 * Where the super-agent writes to the owner unasked (routine news, confirmations, reminders): a channel, a paired
 * phone's push, or the first channel that knows them. If the chosen one refuses a message, the core tries the next.
 */
export function NoticeChannelSelect({ label }: { label: string }) {
  const t = useT();
  const prefs = useChannels((s) => s.notices);
  const channels = useChannels((s) => s.channels);
  const [devices, setDevices] = useState<Device[]>([]);
  useEffect(() => {
    void loadChannels();
    void client
      .call("devices.list", {})
      .then((r) => setDevices(r.devices))
      .catch(() => setDevices([]));
  }, []);
  if (!prefs) return null;
  return (
    <Select
      label={label}
      value={prefs.channel ?? "auto"}
      onValueChange={(v) => void saveNotices({ ...prefs, channel: v && v !== "auto" ? v : undefined })}
      options={[
        { value: "auto", label: t("nudge.whereAuto") },
        ...channels.map((c) => ({ value: c.id, label: c.account ? `${c.label} · ${c.account}` : c.label })),
        ...devices
          .filter((d) => d.push)
          .map((d) => ({ value: `device:${d.id}`, label: t("nudge.wherePhone", { name: d.name }) })),
      ]}
    />
  );
}
