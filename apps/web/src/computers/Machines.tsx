import type { Result } from "@apx/protocol";
import { AgentAvatar, Button, Icons, ProjectTile } from "@apx/ui";
import { type ReactNode, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { screensUp } from "./agent.ts";

type Host = Result<"computers.host">;
type Status = Result<"environments.status">;
type Dot = "on" | "idle" | "off";

const OS_LABEL: Record<Host["os"], string> = { macos: "macOS", windows: "Windows", linux: "Linux", other: "" };

/** The computer the core runs on, read again every few seconds while the list is open; undefined until it answers. */
function useHost(): Host | undefined {
  const [host, setHost] = useState<Host>();
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await client.withSignal(abort.signal).call("computers.host", {});
        if (!abort.signal.aborted) setHost(next);
      } catch {
        // A core without it lists only the VM.
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 5000);
      }
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, []);
  return host;
}

/** One machine: what it is, who uses it now, and the one thing to do with it. */
function MachineRow({
  icon,
  title,
  sub,
  dot,
  state,
  who,
  action,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  dot: Dot;
  state: string;
  who?: Array<{ id: string; name: string }>;
  action?: ReactNode;
}) {
  const agents = useData((s) => s.agents);
  return (
    <li className="machines__row">
      <ProjectTile tone="neutral" icon={icon} size={32} />
      <span className="machines__main">
        <span className="machines__title">{title}</span>
        <span className="machines__sub">{sub}</span>
      </span>
      <span className="machines__state">
        {who?.map((a) => (
          <AgentAvatar key={a.id} name={a.name} blob={agents[a.id]?.blob} size={18} animated={false} />
        ))}
        <span className={`machines__dot is-${dot}`} />
        {state}
      </span>
      <span className="machines__action">{action}</span>
    </li>
  );
}

/**
 * The machines agents work on: this computer (lent through the desktop app) and the isolated Linux computer, whose
 * screens follow it. Nothing here is made up: a machine the core does not know is not listed.
 */
export function Machines({
  status,
  busy,
  onPower,
  children,
}: {
  status: Status | undefined;
  busy: boolean;
  onPower(on: boolean): void;
  /** The VM's screens, under its row. */
  children?: ReactNode;
}) {
  const t = useT();
  const host = useHost();
  const ready = Boolean(status?.ready);
  const starting = status?.phase === "preparing" || status?.phase === "stopping";
  const screens = status?.screens ?? [];
  const vmUsers = screens.flatMap((s) => (s.agent ? [{ id: s.agent, name: s.agent_name ?? s.agent }] : []));
  const names = (list: Array<{ name: string }>) => list.map((a) => a.name).join(", ");
  return (
    <ul className="machines">
      {host && (
        <MachineRow
          icon={<Icons.Monitor size={16} />}
          title={host.name}
          sub={[t("machines.here"), OS_LABEL[host.os]].filter(Boolean).join(" · ")}
          dot={host.agents.length ? "on" : host.computer_use ? "idle" : "off"}
          state={
            host.agents.length
              ? t("machines.usedBy", { names: names(host.agents) })
              : t(host.computer_use ? "machines.free" : "machines.notLent")
          }
          who={host.agents}
          action={
            <Button
              size="sm"
              variant="secondary"
              title={t(host.computer_use ? "machines.settingsHint" : "machines.setUpHint")}
              onClick={() => go.config("desktop")}
            >
              {t(host.computer_use ? "machines.settings" : "machines.setUp")}
            </Button>
          }
        />
      )}
      {status && (
        <MachineRow
          icon={<Icons.Server size={16} />}
          title={t("machines.vm")}
          sub={[
            "Linux",
            ready
              ? t("computers.lead", { held: screensUp(status), max: status.max_screens ?? 1 })
              : t(starting ? "computer.preparing" : "computers.off"),
          ].join(" · ")}
          dot={ready ? (vmUsers.length ? "on" : "idle") : "off"}
          state={
            ready
              ? vmUsers.length
                ? t("machines.usedBy", { names: names(vmUsers) })
                : t("machines.free")
              : t(starting ? "machines.starting" : "machines.off")
          }
          who={vmUsers}
          action={
            ready ? (
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                title={t("machines.stopHint")}
                onClick={() => onPower(false)}
              >
                {t("computer.stop")}
              </Button>
            ) : status.needs ? undefined : (
              <Button
                size="sm"
                loading={busy || starting}
                title={t("machines.startHint")}
                onClick={() => onPower(true)}
              >
                {t("computer.start")}
              </Button>
            )
          }
        />
      )}
      {children && <li className="machines__screens">{children}</li>}
    </ul>
  );
}
