// A remote APX (an address, or one over SSH) the window waits for: the screen says so and it retries until the server
// answers, then loads the panel. A server restarting after an update, or this app restarting, comes back on its own.
import type { Tunnel } from "./ssh-tunnel.ts";

export type Remote = {
  /** Where, as the screen names it ("ops@box (SSH)"). */
  where: string;
  url: string;
  /** The SSH forward, when there is one. */
  tunnel?: Pick<Tunnel, "alive" | "problem" | "restart">;
};

export type WaitDeps = {
  /** Still the connection the owner chose (a change of connection ends the wait). */
  current(): boolean;
  isUp(url: string): Promise<boolean>;
  load(url: string): Promise<boolean>;
  /** Puts the waiting text on screen. */
  show(text: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  es: boolean;
};

export const RETRY_MS = 1500;
/** A forward that stays up this long with nothing answering through it may be half dead: ssh starts again. */
export const SILENT_MS = 30_000;

/** True once the panel loaded and the connection is still the one asked for. */
export async function reachRemote(remote: Remote, d: WaitDeps): Promise<boolean> {
  const linked = () => remote.tunnel?.alive() ?? true;
  let shown: string | undefined;
  let silentSince = d.now();
  while (d.current()) {
    if (!linked()) silentSince = d.now();
    else if (await d.isUp(remote.url)) {
      if (!d.current()) return false;
      if ((await d.load(remote.url)) && linked()) return d.current();
      // A failed load left its own (blank) page: the waiting text goes back on screen.
      shown = undefined;
    } else if (remote.tunnel && d.now() - silentSince >= SILENT_MS) {
      remote.tunnel.restart();
      silentSince = d.now();
    }
    if (!d.current()) return false;
    const text = waitingText(remote, linked(), d.es);
    if (text !== shown) {
      shown = text;
      await d.show(text);
    }
    await d.sleep(RETRY_MS);
  }
  return false;
}

export function waitingText(remote: Remote, linked: boolean, es: boolean): string {
  const problem = linked ? undefined : remote.tunnel?.problem();
  if (es) {
    const why = !remote.tunnel
      ? "Esperando que responda."
      : linked
        ? "La conexión SSH está lista; esperando que APX responda en el servidor (puede estar reiniciándose después de una actualización)."
        : `Esperando la conexión SSH.${problem ? ` ssh dice: ${problem}` : ""}`;
    return `Conectando con APX en ${remote.where}. ${why} Se abre solo cuando responde. Para elegir otro APX: menú APX › Cambiar conexión.`;
  }
  const why = !remote.tunnel
    ? "Waiting for it to answer."
    : linked
      ? "The SSH connection is up; waiting for APX on the server to answer (it may be restarting after an update)."
      : `Waiting for the SSH connection.${problem ? ` ssh says: ${problem}` : ""}`;
  return `Connecting to APX at ${remote.where}. ${why} It opens by itself once it answers. To pick another APX: APX menu › Change connection.`;
}
