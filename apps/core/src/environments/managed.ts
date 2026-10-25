import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Store } from "../domain/store.ts";
import { findProgram, withUsualDirs } from "../programs.ts";
import type { ComputerConfig } from "./computer.ts";
import { vmEgress } from "./egress-tunnel.ts";
import { ensureSecured, verifyGuest } from "./guest-security.ts";
import { createVmLifecycle } from "./lifecycle.ts";
import { installLima, LIMA_VERSION } from "./lima-install.ts";
import { limaProcess } from "./lima-process.ts";
import { GUEST_ASSETS, provisionDesktop, screenDriver } from "./provision.ts";
import {
  type ComputerResources,
  configuredResources,
  diskRefusal,
  limaCreateArgs,
  limaEditArgs,
  resolveResources,
  thisHost,
} from "./resources.ts";
import { computerUsage, diskImageBytes } from "./usage.ts";

const GIB = 1024 ** 3;
/** Each Lima call the resource monitor makes: below its 3 s wait for the VM's numbers. */
const PROBE_MS = 1_200;

/** What the owner set for the VM, held to this host's limits; read at each start, so a change applies on the next one. */
export const ownerResources = (store: Store): ComputerResources =>
  resolveResources(store.settings.read("computer"), thisHost());

/** Construction and status are inert until an owner explicitly enables the computer. */
export function managedVmConfig(store: Store, home: string, external?: ComputerConfig): ComputerConfig {
  const root = path.join(home, "computer");
  const limaHome = external?.limaHome ?? path.join(root, "lima");
  const instance = external?.instance ?? "computer";
  const prepared = path.join(root, "desktop-ready-v3");
  const env = { PATH: withUsualDirs(process.env.PATH ?? ""), HOME: os.homedir(), LIMA_HOME: limaHome };
  const privateBinary = path.join(root, `lima-${LIMA_VERSION}/bin/limactl`);
  let executable =
    external?.executable?.() ??
    (fs.existsSync(privateBinary) ? privateBinary : (findProgram("limactl", env.PATH) ?? privateBinary));
  const binary = () => executable;
  const run = limaProcess(binary, env);
  const egress = vmEgress(limaHome, instance, run);
  const installed = () => fs.existsSync(path.join(limaHome, instance, "lima.yaml"));
  const applied = (): Partial<ComputerResources> => {
    try {
      return configuredResources(fs.readFileSync(path.join(limaHome, instance, "lima.yaml"), "utf8"));
    } catch {
      return {};
    }
  };
  const imageBytes = () => diskImageBytes(path.join(limaHome, instance));
  const running = async (timeout?: number) => {
    if (!installed() || !fs.existsSync(binary())) return false;
    const result = await run(["list", "--json", instance], timeout ? { timeout } : {});
    return result
      .split("\n")
      .filter(Boolean)
      .some((line) => (JSON.parse(line) as { status: string }).status === "Running");
  };
  const stop = async () => {
    await egress.close();
    if (!(await running())) return;
    try {
      await run(["stop", "--tty=false", instance], { timeout: 40_000 });
    } catch {
      await run(["stop", "--force", "--tty=false", instance], { timeout: 20_000 });
    }
  };
  const lifecycle = createVmLifecycle({
    supported: process.platform === "darwin" && process.arch === "arm64" && Number(os.release().split(".")[0]) >= 22,
    installed,
    prepared: () => fs.existsSync(prepared),
    running,
    stop,
    disconnect: () => egress.close(),
    connect: async () => {
      if (!egress.ready()) {
        await verifyGuest(run, instance);
        await egress.connect();
      }
    },
    // Each agent screen follows the appearance when it starts and when it changes (Computer.appearance).
    appearance: async () => {},
    async prepare(_mode, signal, progress) {
      if (limaHome.length > 70) throw new Error("APX home is too long for Lima's SSH sockets; use a shorter APX_HOME");
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      fs.mkdirSync(limaHome, { recursive: true, mode: 0o700 });
      const wanted = ownerResources(store);
      const space = fs.statfsSync(limaHome);
      const disk = diskRefusal(wanted.disk_gib, imageBytes(), space.bavail * space.bsize);
      if (disk) throw new Error(disk);
      if (os.totalmem() < (wanted.memory_gib + 4) * GIB)
        throw new Error(
          `Computer needs a host with at least ${wanted.memory_gib + 4} GiB RAM for a ${wanted.memory_gib} GiB VM`,
        );
      progress({ step: "runtime" });
      if (!fs.existsSync(binary())) executable = await installLima(root, signal, progress);
      const version = await run(["--version"], { signal }).catch(() => "");
      if (!/\b2\./.test(version)) executable = await installLima(root, signal, progress);
      progress({ step: "guest" });
      const edit = installed() ? limaEditArgs(applied(), wanted) : [];
      if (edit.length && !(await running()))
        await run(["edit", "--tty=false", ...edit, instance], { signal, timeout: 60_000 });
      await run(
        [
          "start",
          "--tty=false",
          "--timeout=15m",
          ...(installed()
            ? [instance]
            : [`--name=${instance}`, ...limaCreateArgs(wanted), path.join(GUEST_ASSETS, "lima.yaml")]),
        ],
        { signal, timeout: 16 * 60_000 },
      );
      signal.throwIfAborted();
      progress({ step: "desktop" });
      await ensureSecured(fs.existsSync(prepared), run, instance, signal);
      await egress.connect();
      signal.throwIfAborted();
      await provisionDesktop(run, instance, signal, external?.demo);
      signal.throwIfAborted();
      fs.writeFileSync(prepared, "1\n", { mode: 0o600 });
    },
  });
  return {
    ...external,
    limaHome,
    instance,
    executable: binary,
    env,
    lifecycle,
    screens: screenDriver(run, instance),
    applied,
    usage: () =>
      computerUsage({
        name: instance,
        // Inside the monitor's own wait, so a probe that hangs is killed rather than left behind.
        running: () => running(PROBE_MS),
        assigned: () => (installed() ? applied() : ownerResources(store)),
        imageBytes,
        meminfo: () => run(["shell", instance, "--", "cat", "/proc/meminfo"], { timeout: PROBE_MS }),
      }),
  };
}
