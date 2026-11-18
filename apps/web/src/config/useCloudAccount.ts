import type { AccountProfile } from "@apx/protocol";
import { useEffect, useRef, useState } from "react";
import { accountReturnState } from "../data/account.ts";
import { client } from "../data/client.ts";
import { useSlice } from "../data/createStore.ts";
import { accountPhotoRead } from "../data/owner.ts";
import { onSignInDone } from "../data/signInWindow.ts";

export function useCloudAccount() {
  const returned = useSlice(accountReturnState, (s) => s);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<unknown>();
  const [readError, setReadError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(0);
  const version = useRef(0);
  const lastRead = useRef(0);
  const confirmed = useRef<string | undefined>(undefined);
  const alive = useRef(true);
  const mutating = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (revision === 0 && returned.revision === 0) setLoading(true);
    const current = ++version.current;
    lastRead.current = Date.now();
    void client
      .call("account.get", {})
      .then((result) => {
        if (version.current !== current) return;
        setProfile(result.profile);
        accountPhotoRead(result.profile?.photo ?? "");
        setAvailable(result.available);
        setReadError(undefined);
        if (confirmed.current !== result.profile?.handle) {
          confirmed.current = result.profile?.handle;
          setHandle(result.profile?.handle ?? "");
        }
        if (result.profile || !result.pending) setWaiting(false);
      })
      .catch((reason: unknown) => {
        if (version.current === current) setReadError(reason);
      })
      .finally(() => {
        if (version.current === current) setLoading(false);
      });
    return () => {
      version.current++;
    };
  }, [revision, returned]);
  useEffect(() => {
    const refresh = () => {
      if (!mutating.current) setRevision((value) => value + 1);
    };
    const focus = () => {
      if (waiting || Date.now() - lastRead.current >= 15_000) refresh();
    };
    window.addEventListener("focus", focus);
    const off = onSignInDone((id) => {
      if (id === "account") {
        setWaiting(false);
        refresh();
      }
    });
    return () => {
      off();
      window.removeEventListener("focus", focus);
    };
  }, [waiting]);
  useEffect(() => {
    if (returned.error) {
      setError(new Error(returned.error));
      setWaiting(false);
    }
  }, [returned]);
  const run = async (action: () => Promise<void>) => {
    if (mutating.current) return;
    mutating.current = true;
    ++version.current;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await action();
    } catch (reason) {
      if (alive.current) setError(reason);
    } finally {
      mutating.current = false;
      if (alive.current) {
        setBusy(false);
        setRevision((value) => value + 1);
      }
    }
  };
  const start = () => {
    if (mutating.current) return;
    const desktop = window.apxDesktop;
    const popup = desktop ? null : window.open("about:blank", "_blank");
    if (!desktop && !popup) {
      setError(new Error("browser_blocked"));
      return;
    }
    if (popup) popup.opener = null;
    return run(async () => {
      try {
        const result = await client.call("account.start", { desktop: Boolean(desktop) });
        if (desktop?.openExternal) await desktop.openExternal(result.url);
        else popup?.location.replace(result.url);
        if (alive.current) setWaiting(true);
      } catch (reason) {
        popup?.close();
        throw reason;
      }
    });
  };
  const logout = () =>
    run(async () => {
      await client.call("account.logout", {});
      if (alive.current) {
        setProfile(null);
        accountPhotoRead("");
        setWaiting(false);
      }
    });
  const save = () =>
    run(async () => {
      const result = await client.call("account.rename", { handle });
      if (alive.current) {
        setProfile(result.profile);
        setHandle(result.profile.handle);
        setSaved(true);
      }
    });
  const reload = () => {
    setReadError(undefined);
    setRevision((value) => value + 1);
  };
  return {
    profile,
    available,
    loading,
    busy,
    waiting,
    handle,
    setHandle,
    error: error ?? readError,
    canReload: error == null && readError != null,
    saved,
    start,
    logout,
    save,
    reload,
  };
}
