import { Button, Input } from "@apx/ui";
import { useState } from "react";
import { addOwnerAddress } from "../data/channels.ts";
import { useT } from "../i18n/index.ts";

/** A phone number typed by hand becomes the owner's address on this channel. */
export function PhoneForm({ channelId }: { channelId: string }) {
  const t = useT();
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const digits = number.replace(/\D/g, "");
  const add = async () => {
    if (digits.length < 8) return;
    setBusy(true);
    if (await addOwnerAddress(channelId, number)) setNumber("");
    setBusy(false);
  };
  return (
    <div className="tgtoken">
      <Input
        aria-label={t("ch.phoneAdd")}
        inputMode="tel"
        placeholder="+54 9 11 1234-5678"
        value={number}
        onChange={(e) => setNumber(e.currentTarget.value.replace(/[^\d+\-\s()]/g, "").slice(0, 24))}
        onKeyDown={(e) => e.key === "Enter" && void add()}
      />
      <Button size="sm" disabled={digits.length < 8} loading={busy} onClick={() => void add()}>
        {t("ch.phoneAddButton")}
      </Button>
    </div>
  );
}

/** "5491100000000@s.whatsapp.net" → "+5491100000000"; other addresses as they are. */
export const phoneOf = (address: string) => {
  const digits = /^(\d{6,})@s\.whatsapp\.net$/.exec(address)?.[1];
  return digits ? `+${digits}` : address;
};
