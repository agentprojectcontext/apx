import type { Health } from "@apx/protocol";
import { ApxClient } from "@apx/protocol/client";
import { useEffect, useState } from "react";

const client = new ApxClient({ url: window.location.origin, client: { name: "apx-web", version: "0.0.0" } });

export function useHealth(intervalMs = 5000): { health: Health | undefined; error: string | undefined } {
  const [health, setHealth] = useState<Health>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    const tick = () =>
      client
        .call("system.health", {})
        .then((h) => alive && (setHealth(h), setError(undefined)))
        .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);
  return { health, error };
}
