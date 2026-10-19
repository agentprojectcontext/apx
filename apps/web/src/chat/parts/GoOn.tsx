import { Button } from "@apx/ui";
import { useState } from "react";
import { client } from "../../data/client.ts";
import { notify } from "../../data/notices.ts";
import { useT } from "../../i18n/index.ts";

/** A paused chain's way on: a fresh budget, or no limit until the owner writes there again (DECISIONS.md#d-081). */
export function GoOn({ thread }: { thread: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  if (done) return <span className="noticeline__done">{t("notice.breaker.wentOn")}</span>;
  const go = (mode: "reset" | "release") =>
    void client
      .call("threads.go_on", { thread, mode })
      .then(() => setDone(true))
      .catch((e: unknown) => notify(e instanceof Error ? e.message : String(e)));
  return (
    <>
      <Button size="sm" variant="ghost" className="noticeline__link" onClick={() => go("reset")}>
        {t("notice.breaker.reset")}
      </Button>
      <Button size="sm" variant="ghost" className="noticeline__link" onClick={() => go("release")}>
        {t("notice.breaker.release")}
      </Button>
    </>
  );
}
