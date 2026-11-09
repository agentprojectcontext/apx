import "../styles/server-list.css";
import { Button, Icons, PickRow } from "@apx/ui";
import { useState } from "react";
import { useT } from "../i18n/index.ts";
import type { ServerRow, ServerRows } from "./serverRows.ts";

/**
 * The top bar's server list: picking one opens it here. The foot connects to another one: the desktop app opens its
 * connection flow; a browser says where that is done.
 */
export function ServerList({ rows, onClose }: { rows: ServerRows; onClose: () => void }) {
  const t = useT();
  const [hint, setHint] = useState(false);
  const [opening, setOpening] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const desktop = window.apxDesktop;
  const change = desktop?.menuAction;

  const pick = async (row: ServerRow) => {
    if (row.current || !desktop?.openServer) return onClose();
    setFailed(undefined);
    setOpening(row.id);
    // Once it answers the window opens that server's panel and this page goes away.
    const answer = await desktop.openServer(row.id).catch(() => undefined);
    setOpening(undefined);
    if (answer?.ok) onClose();
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
    <>
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
            onClose();
            change("change-connection");
          } else setHint((v) => !v);
        }}
      >
        {t("server.connectRemote")}
      </Button>
      {hint && <p className="serverswitch__hint">{t("server.connectRemoteHint")}</p>}
    </>
  );
}
