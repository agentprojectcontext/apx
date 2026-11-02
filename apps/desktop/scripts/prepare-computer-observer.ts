import path from "node:path";
import { targetOf } from "@apx/protocol";
import { buildObserverResource } from "./build-computer-observer.ts";

/** Build input only; never consulted when launching an observer. */
export function prepareDesktopObserver(config: {
  output: string;
  platform: string;
  arch: string;
  target?: string;
  build?: typeof buildObserverResource;
}): ReturnType<typeof buildObserverResource> {
  const target = targetOf(config.target, config.platform, config.arch);
  if (!target) throw new Error("INVALID_DESKTOP_BUILD_TARGET");
  if (target.os === "mac" && config.platform !== "darwin") throw new Error("MAC_OBSERVER_REQUIRES_MACOS_BUILD_HOST");
  const result = (config.build ?? buildObserverResource)({
    output: path.join(config.output, "native"),
    architectures: [target.arch],
    platform: target.os === "mac" ? "darwin" : target.os === "win" ? "win32" : "linux",
  });
  if (target.os === "mac" && result.kind !== "built") throw new Error("MAC_OBSERVER_BUILD_REQUIRED");
  if (target.os !== "mac" && result.kind !== "unsupported") throw new Error("UNEXPECTED_OBSERVER_RESOURCE");
  return result;
}
