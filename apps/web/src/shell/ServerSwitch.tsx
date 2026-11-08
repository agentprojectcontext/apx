import { Button, Icons, PickRow, Popover } from "@apx/ui";
import { useState } from "react";
import { useData } from "../data/state.ts";
import { useUsage } from "../data/usage.ts";
import { useT } from "../i18n/index.ts";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The APX this panel talks to: this computer or a server elsewhere, and the computer's own name when the core says it. */
function useServer(): { name: string; local: boolean; machine: string | undefined } {
  const t = useT();
  // The top bar's resources gauge reads the core's usage; its computer name comes with it.
  const machine = useUsage(undefined).usage?.host.name;
  const desktop = window.apxDesktop;
  const host = window.location.hostname;
  const local = desktop ? desktop.coreLocal !== false : LOOPBACK.has(host);
  return { name: local ? t("server.local") : (machine ?? host), local, machine };
}

/**
 * Topbar: which APX is in use, listed under Local or Remote with its computer and whether it answers. The foot connects
 * to another one: the desktop app opens its connection flow; a browser says where that is done.
 */
export function ServerSwitch() {
  const t = useT();
  const connection = useData((s) => s.connection);
  const { name, local, machine } = useServer();
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(false);
  const online = connection === "online";
  const change = window.apxDesktop?.menuAction;
  const sub = local
    ? online
      ? machine
        ? t("server.thisComputerNamed", { name: machine })
        : t("server.thisComputer")
      : t("server.offline")
    : !online
      ? t("server.remoteOffline")
      : machine && !LOOPBACK.has(window.location.hostname)
        ? t("server.remoteSub", { name: window.location.hostname })
        : t("server.remote");
  return (
    <Popover
      align="start"
      width={290}
      className="serverswitch__pop"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setHint(false);
      }}
      label={t("server.label", { name })}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className="serverswitch"
          aria-label={t("server.label", { name })}
          title={t("server.label", { name })}
          leadingIcon={
            <span className="serverswitch__icon">
              {local ? <Icons.Monitor size={16} /> : <Icons.Globe size={16} />}
              <span className={online ? "serverswitch__dot is-online" : "serverswitch__dot"} aria-hidden="true" />
            </span>
          }
          trailingIcon={<Icons.ChevronDown size={14} className="serverswitch__chev" />}
        >
          <span className="serverswitch__name">{name}</span>
        </Button>
      }
    >
      <div className="serverswitch__head">{t(local ? "server.localHead" : "server.remoteHead")}</div>
      <PickRow
        className="serverswitch__row"
        leading={local ? <Icons.Monitor size={16} /> : <Icons.Globe size={16} />}
        title={name}
        description={sub}
        dot={online ? "on" : "off"}
        trailing={<Icons.Check size={14} className="serverswitch__check" aria-label={t("server.online")} />}
        selected
        onClick={() => setOpen(false)}
      />
      <div className="serverswitch__sep" />
      <Button
        variant="ghost"
        size="sm"
        className="serverswitch__connect"
        leadingIcon={<Icons.Plus size={14} />}
        aria-expanded={change ? undefined : hint}
        onClick={() => {
          if (change) {
            setOpen(false);
            change("change-connection");
          } else setHint((v) => !v);
        }}
      >
        {t("server.connectRemote")}
      </Button>
      {hint && <p className="serverswitch__hint">{t("server.connectRemoteHint")}</p>}
    </Popover>
  );
}
