import { Button, Icons, Popover } from "@apx/ui";
import { Suspense, useEffect, useState } from "react";
import type { KnownServer } from "../apx-desktop.d.ts";
import { useData } from "../data/state.ts";
import { useUsage } from "../data/usage.ts";
import { useT } from "../i18n/index.ts";
import { ServerList } from "../lazy.ts";
import { LOOPBACK, serverRows } from "./serverRows.ts";

/**
 * Topbar: which APX is in use, and in the desktop app every other one it has used, under Local or Remote with its
 * computer and whether it answers (ServerList, loaded when it opens).
 */
export function ServerSwitch() {
  const t = useT();
  const connection = useData((s) => s.connection);
  // The top bar's resources gauge reads the core's usage; its computer name comes with it.
  const machine = useUsage(undefined).usage?.host.name;
  const [open, setOpen] = useState(false);
  const [known, setKnown] = useState<KnownServer[]>();
  const desktop = window.apxDesktop;
  const host = window.location.hostname;
  const local = desktop ? desktop.coreLocal !== false : LOOPBACK.has(host);
  const rows = serverRows(known, { local, online: connection === "online", machine, host }, t);
  const name = rows.current.title;

  useEffect(() => {
    if (machine) window.apxDesktop?.nameServer?.(machine);
  }, [machine]);

  useEffect(() => {
    const servers = window.apxDesktop?.servers;
    if (!open || !servers) return;
    let live = true;
    servers().then(
      (r) => {
        if (live && r) setKnown(r.servers);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [open]);

  return (
    <Popover
      align="start"
      width={290}
      className="serverswitch__pop"
      open={open}
      onOpenChange={setOpen}
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
              <span
                className={rows.current.dot === "on" ? "serverswitch__dot is-online" : "serverswitch__dot"}
                aria-hidden="true"
              />
            </span>
          }
          trailingIcon={<Icons.ChevronDown size={14} className="serverswitch__chev" />}
        >
          <span className="serverswitch__name">{name}</span>
        </Button>
      }
    >
      <Suspense fallback={null}>
        <ServerList rows={rows} onClose={() => setOpen(false)} />
      </Suspense>
    </Popover>
  );
}
