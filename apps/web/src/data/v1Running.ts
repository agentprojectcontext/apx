// Whether APX v1's daemon still runs beside this one (its routines and bots would run twice), and turning it off.
import { useEffect, useState } from "react";
import { client } from "./client.ts";
import { notify } from "./notices.ts";

const EVERY_MS = 5 * 60_000;

export function useV1Running(): { running: boolean; busy: boolean; turnOff(): Promise<void> } {
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const check = () =>
      client
        .call("setup.status", {})
        .then((s) => live && setRunning(s.v1_running === true))
        .catch(() => undefined);
    void check();
    const timer = window.setInterval(check, EVERY_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);
  const turnOff = async () => {
    setBusy(true);
    try {
      const res = await client.call("setup.take_over_cli", {});
      const status = await client.call("setup.status", {});
      setRunning(status.v1_running === true);
      if (!res.ok) notify(res.detail);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { running, busy, turnOff };
}
