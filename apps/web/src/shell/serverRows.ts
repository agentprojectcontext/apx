// The rows of the top bar's server list: this computer's APX under Local, the others under Remote, each with what is
// really known of it (its computer name, where it is, whether it answers).
import type { KnownServer } from "../apx-desktop.d.ts";
import type { T } from "../i18n/index.ts";

export const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The server this page talks to, as the page sees it. */
export type Here = {
  local: boolean;
  online: boolean;
  /** The computer name its core reports. */
  machine?: string;
  /** The page's own host name. */
  host: string;
};

export type ServerRow = {
  id: string;
  local: boolean;
  title: string;
  sub: string;
  /** No dot when nobody asked whether it answers. */
  dot?: "on" | "off";
  current: boolean;
};

export type ServerRows = { current: ServerRow; local: ServerRow[]; remote: ServerRow[] };

/** `known` is the desktop app's list; a browser has none, so it shows only the server in use. */
export function serverRows(known: KnownServer[] | undefined, here: Here, t: T): ServerRows {
  const inUse = known?.find((s) => s.current);
  const current = currentRow(inUse, here, t);
  const rows = [
    current,
    ...(known ?? []).filter((s) => !s.current).map((s) => (s.kind === "local" ? localRow(s, t) : remoteRow(s, t))),
  ];
  return { current, local: rows.filter((r) => r.local), remote: rows.filter((r) => !r.local) };
}

function currentRow(s: KnownServer | undefined, here: Here, t: T): ServerRow {
  const dot = here.online ? "on" : "off";
  const id = s?.id ?? "current";
  if (here.local) {
    const name = here.machine ?? s?.name;
    const sub = !here.online
      ? t("server.offline")
      : name
        ? t("server.thisComputerNamed", { name })
        : t("server.thisComputer");
    return { id, local: true, title: t("server.local"), sub, dot, current: true };
  }
  const where = s?.host ?? (LOOPBACK.has(here.host) ? undefined : here.host);
  const title = here.machine ?? s?.name ?? where ?? here.host;
  return { id, local: false, title, sub: remoteSub(title, where, here.online, t), dot, current: true };
}

function localRow(s: KnownServer, t: T): ServerRow {
  const sub =
    s.online === false
      ? t("server.thisComputerOffline")
      : s.name
        ? t("server.thisComputerNamed", { name: s.name })
        : t("server.thisComputer");
  return { id: s.id, local: true, title: t("server.local"), sub, ...dotOf(s), current: false };
}

function remoteRow(s: KnownServer, t: T): ServerRow {
  const title = s.name ?? s.host ?? t("server.remote");
  return { id: s.id, local: false, title, sub: remoteSub(title, s.host, s.online, t), ...dotOf(s), current: false };
}

function remoteSub(title: string, where: string | undefined, online: boolean | undefined, t: T): string {
  if (online === false) return t("server.remoteOffline");
  return where && where !== title ? t("server.remoteSub", { name: where }) : t("server.remote");
}

const dotOf = (s: KnownServer): { dot?: "on" | "off" } =>
  s.online === undefined ? {} : { dot: s.online ? "on" : "off" };
