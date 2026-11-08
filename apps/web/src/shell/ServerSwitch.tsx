import { Button, Icons, Menu, type MenuEntry } from "@apx/ui";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";

/** The APX this panel talks to: this computer or a server elsewhere, with a dot for the connection. */
function useServer(): { name: string; local: boolean } {
  const t = useT();
  const desktop = window.apxDesktop;
  const host = window.location.hostname;
  const local = desktop
    ? desktop.coreLocal !== false
    : host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  return { name: local ? t("server.local") : host, local };
}

/** Topbar: which APX is in use; in the desktop app its menu also connects to another one. */
export function ServerSwitch() {
  const t = useT();
  const connection = useData((s) => s.connection);
  const { name, local } = useServer();
  const online = connection === "online";
  const change = window.apxDesktop?.menuAction;
  const items: MenuEntry[] = [
    { type: "label", label: online ? t("server.online") : t("server.offline") },
    { label: name, icon: local ? <Icons.Monitor /> : <Icons.Server />, checked: true, onSelect: () => {} },
    ...(change
      ? ([
          { type: "separator" },
          { label: t("server.change"), icon: <Icons.Plus />, onSelect: () => change("change-connection") },
        ] satisfies MenuEntry[])
      : []),
  ];
  return (
    <Menu
      align="start"
      items={items}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className="serverswitch"
          aria-label={t("server.label", { name })}
          leadingIcon={
            <span className="serverswitch__icon">
              {local ? <Icons.Monitor size={16} /> : <Icons.Server size={16} />}
              <span className={online ? "serverswitch__dot is-online" : "serverswitch__dot"} aria-hidden="true" />
            </span>
          }
          trailingIcon={<Icons.ChevronDown size={14} className="serverswitch__chev" />}
        >
          <span className="serverswitch__name">{name}</span>
        </Button>
      }
    />
  );
}
