import { Button, Icons, Tooltip } from "@apx/ui";
import { useEffect } from "react";
import { agentComputer } from "../../computers/agent.ts";
import { computersOf } from "../../computers/summary.ts";
import { client } from "../../data/client.ts";
import { data, useData } from "../../data/state.ts";
import { usePack, useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";

/** The computer as the sidebar and the agents' cards show it, read again (an agent's screen comes and goes). */
async function refreshComputers(): Promise<void> {
  try {
    data.set({ computers: computersOf(await client.call("environments.status", {})) });
  } catch {}
}

/**
 * The agent's card row for the isolated computer: whether it may use it and where it works, with the way to turn it
 * on (its settings page) or to watch it (the Computers view, reachable here even before the sidebar shows it).
 */
function AgentComputerBody({ agent, onTurnOn }: { agent: string; onTurnOn(): void }) {
  const t = useT();
  const computers = useData((s) => s.computers);
  const at = agentComputer(computers, agent);
  useEffect(() => {
    void refreshComputers();
  }, []);
  const state =
    at.state === "running"
      ? t(at.held ? "agent.computer.working" : "agent.computer.running", { screen: at.screen })
      : t(at.state === "allowed" ? "agent.computer.allowed" : "agent.computer.off");
  return (
    <>
      <dt className="teamdetail__hinted">
        {t("agent.computer")}
        <Tooltip content={t("agent.computer.hint")}>
          <button type="button" className="teamdetail__hint" aria-label={t("agent.computer.hint")}>
            <Icons.Info size={12} />
          </button>
        </Tooltip>
      </dt>
      <dd className="teamdetail__computer">
        <span className={at.state === "off" ? "teamdetail__muted" : undefined}>{state}</span>
        <Button size="sm" variant="secondary" onClick={() => (at.state === "off" ? onTurnOn() : go.view("computers"))}>
          {t(at.state === "off" ? "agent.computer.turnOn" : "agent.computer.open")}
        </Button>
      </dd>
    </>
  );
}

/** Only on a host that can run the computer, once its strings are loaded: they come with it. */
export function AgentComputer(props: Parameters<typeof AgentComputerBody>[0]) {
  const supported = useData((s) => s.computers.supported);
  return usePack("computer") && supported ? <AgentComputerBody {...props} /> : null;
}
