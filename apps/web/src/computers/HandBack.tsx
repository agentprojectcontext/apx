import { Button } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { usePack, useT } from "../i18n/index.ts";

/** The owner holds the agent's screen: one click gives it back, and the agent can be asked again. */
function HandBackBody({ screen }: { screen: number }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const give = async () => {
    setState("busy");
    try {
      await client.call("environments.control", { screen, mode: "agent" });
      setState("done");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
      setState("idle");
    }
  };
  return (
    <Button
      size="sm"
      variant="secondary"
      className="notice__action"
      disabled={state !== "idle"}
      onClick={() => void give()}
    >
      {t(state === "done" ? "computer.handBack.done" : "computer.handBack")}
    </Button>
  );
}

/** Loaded with the computer's strings, only when a turn was blocked by the owner's hands. */
export function HandBack(props: { screen: number }) {
  return usePack("computer") ? <HandBackBody {...props} /> : null;
}
