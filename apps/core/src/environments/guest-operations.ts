import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import type { Store } from "../domain/store.ts";
import { conflict, unauthorized, unavailable } from "../errors.ts";
import { createHeadlessBrowser } from "../nodes/headless-browser.ts";
import type { ComputerControl } from "./control.ts";
import type { VmPrototypeConfig } from "./prototype.ts";
import { workerArgs } from "./worker.ts";

type Command = { code: number; output: string };
type Ticket = { expires: number; thread: string; device?: string };

export function guestOperations(
  store: Store,
  config: VmPrototypeConfig,
  check: (id: string) => void,
  requireRunning: (id: string) => Promise<void>,
  control: ComputerControl,
) {
  const env = config.env ?? { PATH: process.env.PATH, HOME: process.env.HOME, LIMA_HOME: config.limaHome };
  const binary = config.executable ?? (() => "limactl");
  const tickets = new Map<string, Ticket>();
  const streams = new Map<ChildProcess, string | undefined>();
  const checkDevice = (id?: string) => {
    if (id && !store.devices.get(id)) throw unauthorized("device revoked");
  };
  const commands = new Set<ChildProcess>();
  let busy = false;
  let active: string | undefined;
  const browser = createHeadlessBrowser({
    dir: "",
    blockedPorts: () => new Set(),
    onChange: () => {},
    remote: {
      selectAllModifiers: 2,
      check: control.checkCdp,
      keepAlive: () => true,
      launch() {
        config.lifecycle?.assertRunning();
        const child = spawn(binary(), ["shell", config.instance, "--", ...workerArgs("/usr/local/bin/apx-browser")], {
          env,
          stdio: ["pipe", "pipe", "ignore"],
        });
        return { child, input: child.stdout, output: child.stdin };
      },
    },
  });

  const exec = (args: string[], timeout = 10_000): Promise<string> =>
    new Promise((resolve, reject) => {
      const child = execFile(binary(), args, { env, timeout, maxBuffer: 512 * 1024 }, (error, stdout) => {
        commands.delete(child);
        if (error) reject(unavailable("VM command failed; no command was run on the host"));
        else resolve(stdout);
      });
      commands.add(child);
    });
  const disconnect = async (final = false) => {
    if (final) browser.close();
    else browser.stop();
    tickets.clear();
    const children = [...streams.keys(), ...commands];
    streams.clear();
    commands.clear();
    await Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              resolve();
              return;
            }
            const deadline = setTimeout(() => child.kill("SIGKILL"), 1000);
            child.once("close", () => {
              clearTimeout(deadline);
              resolve();
            });
            child.kill();
          }),
      ),
    );
  };
  return {
    busy: () => busy,
    exec,
    disconnect,
    browser: {
      ...browser,
      handle: (...args: Parameters<typeof browser.handle>) => control.run("agent", () => browser.handle(...args)),
    },
    async interrupt() {
      if (active)
        await exec(["shell", config.instance, "--", ...workerArgs("/usr/local/bin/apx-command", "--cancel", active)]);
    },
    revokeDevice(id: string) {
      for (const [ticket, value] of tickets) if (value.device === id) tickets.delete(ticket);
      for (const [child, device] of streams)
        if (device === id) {
          child.kill();
          streams.delete(child);
        }
    },
    display(id: string, device?: string) {
      checkDevice(device);
      check(id);
      config.lifecycle?.assertRunning();
      const now = Date.now();
      for (const [key, value] of tickets) if (value.expires < now) tickets.delete(key);
      if (tickets.size + streams.size >= 6) throw conflict("too many display sessions");
      const ticket = randomBytes(24).toString("hex");
      tickets.set(ticket, { thread: id, expires: now + 30_000, ...(device ? { device } : {}) });
      return { ticket, expires_in: 30 };
    },
    connectDisplay(ticket: string) {
      const entry = tickets.get(ticket);
      tickets.delete(ticket);
      if (!entry || entry.expires < Date.now()) throw conflict("display ticket expired");
      checkDevice(entry.device);
      check(entry.thread);
      return () => {
        checkDevice(entry.device);
        config.lifecycle?.assertRunning();
        const child = spawn(binary(), ["shell", config.instance, "--", "nc", "127.0.0.1", "5901"], {
          env,
          stdio: ["pipe", "pipe", "ignore"],
        });
        streams.set(child, entry.device);
        child.once("close", () => streams.delete(child));
        return child;
      };
    },
    async command(id: string, command: string, actor: "agent" | "human" = "agent"): Promise<Command> {
      const version = control.version();
      await requireRunning(id);
      control.assert(actor, version);
      if (busy) throw conflict("another command is running in this VM");
      busy = true;
      const operation = randomUUID();
      active = operation;
      const record = (state: string) =>
        store.settings.set(
          `vm_operation:${operation}`,
          JSON.stringify({ thread: id, state, at: new Date().toISOString() }),
        );
      record("working");
      try {
        const raw = await exec(
          [
            "shell",
            config.instance,
            "--",
            ...workerArgs("/usr/local/bin/apx-command", Buffer.from(command).toString("base64"), operation),
          ],
          50_000,
        );
        const result = JSON.parse(raw) as Command;
        if (!Number.isInteger(result.code) || typeof result.output !== "string")
          throw new Error("invalid guest result");
        record(result.code === 0 ? "completed" : "failed");
        return { code: result.code, output: result.output.slice(0, 131072) };
      } catch (error) {
        record("failed");
        throw error;
      } finally {
        busy = false;
        active = undefined;
      }
    },
  };
}
