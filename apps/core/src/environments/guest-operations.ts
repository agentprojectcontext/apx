import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import type { Store } from "../domain/store.ts";
import { conflict, unauthorized } from "../errors.ts";
import { createHeadlessBrowser } from "../nodes/headless-browser.ts";
import type { ComputerConfig } from "./computer.ts";
import type { ComputerControl } from "./control.ts";
import { guestExecutor, stopGuestProcesses } from "./guest-exec.ts";
import { screenArgs, screenUser } from "./worker.ts";

type Command = { code: number; output: string };
type Ticket = { expires: number; screen: number; device?: string };

/** Commands, the visible browser and the viewer of each screen, each as that screen's own user. */
export function guestOperations(
  store: Store,
  config: ComputerConfig,
  control: (screen: number) => ComputerControl,
  touch: () => void = () => {},
) {
  const env = config.env ?? { PATH: process.env.PATH, HOME: process.env.HOME, LIMA_HOME: config.limaHome };
  const binary = config.executable ?? (() => "limactl");
  const tickets = new Map<string, Ticket>();
  const streams = new Map<ChildProcess, { device?: string | undefined; screen: number }>();
  const checkDevice = (id?: string) => {
    if (id && !store.devices.get(id)) throw unauthorized("device revoked");
  };
  const { exec, close: closeCommands } = guestExecutor(binary, env);
  const busy = new Set<number>();
  const active = new Map<number, string>();
  let viewed = 0;
  const browsers = new Map<number, ReturnType<typeof createHeadlessBrowser>>();
  const browserOf = (screen: number) => {
    let browser = browsers.get(screen);
    if (browser) return browser;
    browser = createHeadlessBrowser({
      dir: "",
      blockedPorts: () => new Set(),
      onChange: () => {},
      remote: {
        selectAllModifiers: 2,
        check: (method) => control(screen).checkCdp(method),
        keepAlive: () => true,
        launch() {
          config.lifecycle?.assertRunning();
          const child = spawn(
            binary(),
            ["shell", config.instance, "--", ...screenArgs(screen, "/usr/local/bin/apx-browser")],
            { env, stdio: ["pipe", "pipe", "ignore"] },
          );
          return { child, input: child.stdout, output: child.stdin };
        },
      },
    });
    browsers.set(screen, browser);
    return browser;
  };

  const disconnect = async (final = false) => {
    for (const browser of browsers.values()) final ? browser.close() : browser.stop();
    if (final) browsers.clear();
    tickets.clear();
    const stopped = stopGuestProcesses(streams.keys());
    streams.clear();
    await Promise.all([stopped, closeCommands()]);
  };
  return {
    busy: () => busy.size > 0,
    exec,
    disconnect,
    /** An open viewer counts as use until it closes: someone is looking at a desktop. */
    lastViewed: () => (streams.size ? Date.now() : viewed),
    watching: () => streams.size > 0,
    /** The screens someone is looking at now. */
    watched: () => new Set([...streams.values()].map((s) => s.screen)),
    browser(screen: number) {
      const browser = browserOf(screen);
      return {
        ...browser,
        handle: (...args: Parameters<typeof browser.handle>) =>
          control(screen).run("agent", () => browser.handle(...args)),
      };
    },
    /** Its browser and viewers end with the screen; the user's home and browser profile stay. */
    closeScreen(screen: number) {
      browsers.get(screen)?.stop();
      for (const [ticket, value] of tickets) if (value.screen === screen) tickets.delete(ticket);
      for (const [child, value] of streams)
        if (value.screen === screen) {
          child.kill("SIGKILL");
          streams.delete(child);
        }
    },
    async interrupt(screen: number) {
      const operation = active.get(screen);
      if (operation)
        await exec([
          "shell",
          config.instance,
          "--",
          ...screenArgs(screen, "/usr/local/bin/apx-command", "--cancel", operation),
        ]);
    },
    revokeDevice(id: string) {
      for (const [ticket, value] of tickets) if (value.device === id) tickets.delete(ticket);
      for (const [child, value] of streams)
        if (value.device === id) {
          child.kill("SIGKILL");
          streams.delete(child);
        }
    },
    display(screen: number, device?: string) {
      checkDevice(device);
      config.lifecycle?.assertRunning();
      screenUser(screen);
      const now = Date.now();
      for (const [key, value] of tickets) if (value.expires < now) tickets.delete(key);
      if (tickets.size + streams.size >= 12) throw conflict("too many display sessions");
      const ticket = randomBytes(24).toString("hex");
      tickets.set(ticket, { screen, expires: now + 30_000, ...(device ? { device } : {}) });
      return { ticket, expires_in: 30 };
    },
    /** The viewer reads the screen user's private socket, as that user: no other user can open it. */
    connectDisplay(ticket: string) {
      const entry = tickets.get(ticket);
      tickets.delete(ticket);
      if (!entry || entry.expires < Date.now()) throw conflict("display ticket expired");
      checkDevice(entry.device);
      return {
        screen: entry.screen,
        open: () => {
          checkDevice(entry.device);
          config.lifecycle?.assertRunning();
          const u = screenUser(entry.screen);
          const child = spawn(
            binary(),
            [
              "shell",
              config.instance,
              "--",
              ...screenArgs(entry.screen, "nc", "-U", `/run/user/${u.uid}/apx-vnc.sock`),
            ],
            { env, stdio: ["pipe", "pipe", "ignore"] },
          );
          streams.set(child, { device: entry.device, screen: entry.screen });
          child.once("close", () => {
            streams.delete(child);
            viewed = Date.now();
          });
          return child;
        },
      };
    },
    async command(screen: number, command: string, actor: "agent" | "human" = "agent"): Promise<Command> {
      const lease = control(screen);
      const version = lease.version();
      config.lifecycle?.assertRunning();
      lease.assert(actor, version);
      if (busy.has(screen)) throw conflict("another command is running on this screen");
      busy.add(screen);
      touch();
      const operation = randomUUID();
      active.set(screen, operation);
      try {
        const raw = await exec(
          [
            "shell",
            config.instance,
            "--",
            ...screenArgs(screen, "/usr/local/bin/apx-command", Buffer.from(command).toString("base64"), operation),
          ],
          50_000,
        );
        const result = JSON.parse(raw) as Command;
        if (!Number.isInteger(result.code) || typeof result.output !== "string")
          throw new Error("invalid guest result");
        return { code: result.code, output: result.output.slice(0, 131072) };
      } finally {
        busy.delete(screen);
        active.delete(screen);
        touch();
      }
    },
  };
}
