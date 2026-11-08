import { Button, Icons, PickRow, Popover } from "@apx/ui";
import { useEffect, useState } from "react";
import type { KnownServer } from "../apx-desktop.d.ts";
import { useData } from "../data/state.ts";
import { useUsage } from "../data/usage.ts";
import { useT } from "../i18n/index.ts";
import { LOOPBACK, type ServerRow, serverRows } from "./serverRows.ts";

/**
 * Topbar: which APX is in use, and in the desktop app every other one it has used, under Local or Remote with its
 * computer and whether it answers; picking one opens it here. The foot connects to another one: the desktop app opens
 * its connection flow; a browser says where that is done.
 */
export function ServerSwitch() {
  const t = useT();
  const connection = useData((s) => s.connection);
  // The top bar's resources gauge reads the core's usage; its computer name comes with it.
  const machine = useUsage(undefined).usage?.host.name;
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(false);
  const [known, setKnown] = useState<KnownServer[]>();
  const [opening, setOpening] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const desktop = window.apxDesktop;
  const host = window.location.hostname;
  const local = desktop ? desktop.coreLocal !== false : LOOPBACK.has(host);
  const rows = serverRows(known, { local, online: connection === "online", machine, host }, t);
  const name = rows.current.title;
  const change = desktop?.menuAction;

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

  const pick = async (row: ServerRow) => {
    if (row.current || !desktop?.openServer) {
      setOpen(false);
      return;
    }
    setFailed(undefined);
    setOpening(row.id);
    // Once it answers the window opens that server's panel and this page goes away.
    const answer = await desktop.openServer(row.id).catch(() => undefined);
    setOpening(undefined);
    if (answer?.ok) setOpen(false);
    else setFailed(row.title);
  };

  const list = (head: string, items: ServerRow[]) =>
    items.length > 0 && (
      <>
        <div className="serverswitch__head">{head}</div>
        {items.map((row) => (
          <PickRow
            key={row.id}
            className="serverswitch__row"
            leading={row.local ? <Icons.Monitor size={16} /> : <Icons.Globe size={16} />}
            title={row.title}
            description={opening === row.id ? t("server.connecting") : row.sub}
            dot={row.dot}
            trailing={row.current ? <Icons.Check size={14} className="serverswitch__check" /> : undefined}
            selected={row.current}
            onClick={() => void pick(row)}
          />
        ))}
      </>
    );

  return (
    <Popover
      align="start"
      width={290}
      className="serverswitch__pop"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setHint(false);
          setFailed(undefined);
        }
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
      {list(t("server.localHead"), rows.local)}
      {list(t("server.remoteHead"), rows.remote)}
      {failed && (
        <p className="serverswitch__hint" role="alert">
          {t("server.notAnswering", { name: failed })}
        </p>
      )}
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
