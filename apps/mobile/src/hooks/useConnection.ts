import { useCallback, useEffect, useState } from "react";
import { addressKind, diagnose, hasInternet, type Offline } from "../connectivity";

/** A dropped socket usually comes back within a retry or two: only a longer outage gets a diagnosis on screen. */
const GRACE_MS = 3000;
const RECHECK_MS = 15_000;

/** Why the core is out of reach while `online` is false, once known; undefined while connected or still deciding. */
export function useConnection(url: string, online: boolean, loading: boolean) {
  const [offline, setOffline] = useState<Offline>();
  const [checking, setChecking] = useState(false);
  const check = useCallback(async () => {
    setChecking(true);
    try {
      setOffline(diagnose(await hasInternet(), addressKind(url)));
    } finally {
      setChecking(false);
    }
  }, [url]);
  useEffect(() => {
    if (online || loading) {
      setOffline(undefined);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (stopped) return;
      await check();
      if (!stopped) timer = setTimeout(() => void run(), RECHECK_MS);
    };
    timer = setTimeout(() => void run(), GRACE_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [online, loading, check]);
  return { offline: online ? undefined : offline, checking, check };
}
