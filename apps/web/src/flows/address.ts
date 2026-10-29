// The public address the owner set up in Devices (their Tailscale name, a domain…), read once per screen.
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";

/** The public origin, null when none is set up, undefined while it loads. */
export function usePublicBase(): string | null | undefined {
  const [base, setBase] = useState<string | null>();
  useEffect(() => {
    let live = true;
    void client.call("webhooks.get", {}).then(
      (w) => live && setBase(w.url ? w.url.replace(/\/$/, "") : null),
      () => live && setBase(null),
    );
    return () => {
      live = false;
    };
  }, []);
  return base;
}
