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

/** Drop privileges to a screen's user before any browser, shell or desktop input is interpreted. */
export const screenArgs = (screen: number, ...args: string[]) => {
  const u = screenUser(screen);
  return asUser(u.user, u.uid, args);
};

export const workerArgs = (...args: string[]) => asUser(VM_WORKER, 1001, args);
