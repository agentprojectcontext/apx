import { type Agent, COMPUTER_GRANT, type ToolApproval } from "@apx/protocol";
import { Switch } from "@apx/ui";
import { useState } from "react";
import { computersOf } from "../../../computers/summary.ts";
import { client } from "../../../data/client.ts";
import { data } from "../../../data/state.ts";
import { usePack, useT } from "../../../i18n/index.ts";

/** Whether the agent may use the isolated Linux computer: off until the owner turns it on, applied at once. */
function ComputerPageBody({
  agent,
  grants,
  onChanged,
}: {
  agent: Agent;
  grants: ToolApproval[] | undefined;
  onChanged(): void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const on = Boolean(grants?.some((g) => g.key === COMPUTER_GRANT && g.agent_id === agent.id));
  const set = async (next: boolean) => {
    setBusy(true);
    setError("");
    try {
      await client.call("environments.permit", { agent: agent.id, on: next });
      onChanged();
      // The Computers view appears once an agent may use the computer.
      const status = await client.call("environments.status", {});
      data.set({ computers: computersOf(status) });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Switch
        label={t("agentedit.computer")}
        description={t("agentedit.computerHint")}
        checked={on}
        disabled={busy || !grants}
        onCheckedChange={(v) => void set(v)}
      />
      {error && (
        <p className="config__hint" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** Shown once its strings are loaded: they come with it, not with the editor. */
export function ComputerPage(props: Parameters<typeof ComputerPageBody>[0]) {
  return usePack("computer") ? <ComputerPageBody {...props} /> : null;
}
