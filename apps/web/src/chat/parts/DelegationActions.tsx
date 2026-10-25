import { Button } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { client } from "../../data/client.ts";
import {
  continueDelegation,
  delegationState,
  latestDelegatedRun,
  observeDelegation,
  refreshDelegation,
} from "../../data/delegation.ts";
import { notify } from "../../data/notices.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";

/** The notice records a past limit; its actions always describe the session now. */
export function DelegationActions({ session }: { session: string }) {
  const t = useT();
  const thread = useData((s) => s.threads[session]);
  const runs = useData((s) => s.runs);
  const connection = useData((s) => s.connection);
  const run = latestDelegatedRun(runs, session);
  const [read, setRead] = useState<"loading" | "ready" | "error">("loading");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  useEffect(() => observeDelegation(session), [session]);
  useEffect(() => {
    let active = true;
    setRead("loading");
    if (connection !== "online") return;
    void refreshDelegation(session, true).then(
      () => {
        if (active) setRead("ready");
      },
      () => {
        if (active) setRead("error");
      },
    );
    return () => {
      active = false;
    };
  }, [session, connection]);
  const state = read === "ready" ? delegationState(thread, run) : "loading";
  const online = connection === "online";
  const act = async (action: "continue" | "stop") => {
    if (busy.current || !online) return;
    busy.current = true;
    setPending(true);
    try {
      if (action === "continue" && run) await continueDelegation(session, run.id);
      else if (action === "stop") {
        await client.call("threads.cancel", { thread: session });
        await refreshDelegation(session);
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
      await refreshDelegation(session).catch(() => {});
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return (
    <>
      <span className="noticeline__done" aria-live="polite">
        {t(
          !online
            ? "notice.delegation.limit.offline"
            : read === "error"
              ? "notice.delegation.limit.unavailable"
              : `notice.delegation.limit.${state}`,
        )}
      </span>
      <Button size="sm" variant="ghost" className="noticeline__link" onClick={() => go.subthread(session)}>
        {t("notice.delegation.limit.open")}
      </Button>
      {state === "working" || state === "queued" || state === "waiting" ? (
        <Button
          size="sm"
          variant="ghost"
          className="noticeline__link"
          disabled={pending || !online}
          onClick={() => void act("stop")}
        >
          {t("notice.delegation.limit.stop")}
        </Button>
      ) : state === "stopped" && !thread?.archived ? (
        <Button
          size="sm"
          variant="ghost"
          className="noticeline__link"
          disabled={pending || !online}
          onClick={() => void act("continue")}
        >
          {t(pending ? "notice.delegation.limit.continuing" : "notice.delegation.limit.continue")}
        </Button>
      ) : null}
    </>
  );
}
