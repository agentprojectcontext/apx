import { conflict, errorMessage, unavailable } from "../errors.ts";

export type Appearance = "light" | "dark";
export type ComputerPhase =
  | "not_installed"
  | "stopped"
  | "preparing"
  | "running"
  | "stopping"
  | "error"
  | "unsupported";
export type ComputerStep = "runtime" | "guest" | "desktop";
export type ComputerProgress = { step: ComputerStep; downloaded?: number; total?: number };
export type VmDriver = {
  supported: boolean;
  installed(): boolean;
  prepared?(): boolean;
  running(): Promise<boolean>;
  prepare(mode: Appearance, signal: AbortSignal, progress: (value: ComputerProgress) => void): Promise<void>;
  stop(): Promise<void>;
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
  appearance(mode: Appearance): Promise<void>;
};

/** One lifecycle operation at a time; stopping fences new tools before canceling installation. */
export function createVmLifecycle(driver: VmDriver) {
  let phase: ComputerPhase | undefined;
  let progress: ComputerProgress | undefined;
  let error: string | undefined;
  /** This start sets Linux up for the first time (a download and an install), not a boot of one already there. */
  let setup = false;
  let controller: AbortController | undefined;
  let operation: Promise<void> | undefined;
  let connecting: Promise<void> | undefined;
  let closed = false;
  let stopping = false;
  let generation = 0;
  const track = (task: Promise<void>) => {
    const current = task.finally(() => {
      if (operation === current) operation = undefined;
    });
    operation = current;
  };
  const status = async () => {
    if (closed) return { phase: "error" as const, supported: driver.supported, error: "Computer controller is closed" };
    if (!driver.supported) return { phase: "unsupported" as const, supported: false };
    const observed = generation;
    try {
      const actual =
        phase === "preparing" || phase === "stopping" || phase === "error"
          ? phase
          : !driver.installed()
            ? "not_installed"
            : (await driver.running())
              ? "running"
              : "stopped";
      if (!closed && actual === "running" && observed === generation) {
        if (driver.prepared?.() === false)
          throw new Error("Computer setup was interrupted or needs an update; retry setup to secure the desktop");
        if (driver.connect) {
          connecting ??= driver.connect().finally(() => {
            connecting = undefined;
          });
          await connecting;
        }
      }
      if (observed === generation && !closed) phase = actual;
    } catch (failure) {
      if (observed === generation && !closed) {
        phase = "error";
        error = errorMessage(failure).slice(0, 2000);
      }
    }
    return {
      phase,
      supported: true,
      ...progress,
      ...(phase === "preparing" && setup ? { setup: true } : {}),
      ...(error ? { error } : {}),
    };
  };
  const allowed = () => {
    if (closed) throw unavailable("computer controller is closed");
    if (!driver.supported) throw unavailable("The computer is not available on this system");
  };
  return {
    status,
    /** What the last status saw, without asking the guest (a turn's briefing reads it; the panel polls `status`). */
    known() {
      if (closed)
        return { phase: "error" as const, supported: driver.supported, error: "Computer controller is closed" };
      if (!driver.supported) return { phase: "unsupported" as const, supported: false };
      return {
        ...(phase ? { phase } : {}),
        supported: true,
        ...progress,
        ...(phase === "preparing" && setup ? { setup: true } : {}),
        ...(error ? { error } : {}),
      };
    },
    /** This host can run the computer (Lima has a driver for it: macOS, Linux with KVM, Windows with WSL 2). */
    supported: driver.supported,
    /** The phase last seen, without probing the guest; undefined before the first status. */
    seen: () => phase,
    assertRunning() {
      if (phase !== "running" || closed) throw unavailable("the VM is not ready; start it from Computer");
    },
    start(mode: Appearance) {
      allowed();
      if (operation) throw conflict("a computer lifecycle operation is already running");
      phase = "preparing";
      setup = !(driver.prepared?.() ?? driver.installed());
      generation++;
      stopping = false;
      progress = { step: "runtime" };
      error = undefined;
      controller = new AbortController();
      const signal = controller.signal;
      const deadline = setTimeout(() => controller?.abort(new Error("Computer preparation timed out")), 20 * 60_000);
      deadline.unref();
      track(
        (async () => {
          try {
            await driver.prepare(mode, signal, (value) => {
              if (!signal.aborted) progress = value;
            });
            signal.throwIfAborted();
            phase = "running";
            progress = undefined;
          } catch (failure) {
            try {
              await driver.stop();
            } catch {
              /* The original preparation error remains actionable. */
            }
            if (!stopping && !closed) {
              phase = "error";
              error = errorMessage(failure).slice(0, 2000);
            }
          }
        })().finally(() => {
          clearTimeout(deadline);
          controller = undefined;
        }),
      );
    },
    stop() {
      allowed();
      if (phase === "stopping") return;
      phase = "stopping";
      generation++;
      stopping = true;
      progress = undefined;
      error = undefined;
      controller?.abort();
      const preparation = operation;
      const connection = connecting;
      track(
        (async () => {
          await preparation;
          try {
            await connection?.catch(() => {});
            await driver.stop();
            if (await driver.running()) throw new Error("VM is still running; memory has not been released");
            phase = "stopped";
          } catch (failure) {
            phase = "error";
            error = errorMessage(failure).slice(0, 2000);
          }
        })(),
      );
    },
    async appearance(mode: Appearance) {
      allowed();
      if (!operation && driver.installed() && (await driver.running())) await driver.appearance(mode);
    },
    async close() {
      closed = true;
      generation++;
      controller?.abort();
      await operation;
      await connecting?.catch(() => {});
      await driver.disconnect?.();
    },
  };
}
export type VmLifecycle = ReturnType<typeof createVmLifecycle>;
