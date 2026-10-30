/** The guest's unprivileged probe user: it has no screen; setup checks the firewall and the admin boundary as it. */
export const VM_WORKER = "apx-worker";
export const MAX_SCREEN = 999;

export type ScreenUser = { screen: number; user: string; uid: number; display: string; home: string; work: string };

/** Screens are agents' only: screen n runs as its own locked user, uid 2000+n, on display :100+n. */
export function screenUser(screen: number): ScreenUser {
  if (!Number.isInteger(screen) || screen < 1 || screen > MAX_SCREEN) throw new Error(`invalid screen ${screen}`);
  const user = `apx-a${screen}`;
  const home = `/home/${user}`;
  return { screen, user, uid: 2000 + screen, display: `:${100 + screen}`, home, work: `${home}/work` };
}

/** Where an agent's commands run on its own screen user. */
export const AGENT_WORKSPACE = "~/work";

const asUser = (user: string, uid: number, args: string[]) => [
  "sudo",
  "-n",
  "-u",
  user,
  "-H",
  "env",
  `XDG_RUNTIME_DIR=/run/user/${uid}`,
  ...args,
];

/** The cgroup every process of an agent's screen user lives in: what the loopback rules know a listener by. */
export const screenSlice = (screen: number) => `user-${screenUser(screen).uid}.slice`;

/**
 * Drop privileges to a screen's user before any browser, shell or desktop input is interpreted, inside that user's
 * own slice: run through sudo alone, it would stay in the admin's SSH session and its sockets would carry no agent
 * (DECISIONS.md#d-152). setpriv, not the scope's --uid, so root's supplementary groups are replaced by the user's own.
 */
export const screenArgs = (screen: number, ...args: string[]) => {
  const u = screenUser(screen);
  return [
    "sudo",
    "-n",
    "systemd-run",
    "--quiet",
    "--scope",
    `--slice=${screenSlice(screen)}`,
    "--",
    "setpriv",
    `--reuid=${u.user}`,
    `--regid=${u.user}`,
    "--init-groups",
    "--",
    "env",
    `HOME=${u.home}`,
    `USER=${u.user}`,
    `LOGNAME=${u.user}`,
    `XDG_RUNTIME_DIR=/run/user/${u.uid}`,
    ...args,
  ];
};

export const workerArgs = (...args: string[]) => asUser(VM_WORKER, 1001, args);

/** A screen's visible browser, logging in its user's own home: a shared /tmp log would be the first agent's alone. */
export const browserArgs = (screen: number) =>
  screenArgs(screen, "/usr/local/bin/apx-browser", `${screenUser(screen).home}/.cache/apx/browser.log`);
