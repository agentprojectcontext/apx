import type { Result } from "@apx/protocol";
import type { DesktopUpdate } from "../apx-desktop.d.ts";

/** A remote Desktop always requests one coordinated update, even when only its own release appears newer. */
export function updateTarget(
  status: Result<"system.updates"> | undefined,
  app: DesktopUpdate | undefined,
  coreElsewhere: boolean,
  inApp: boolean,
): { target: "core" | "app" | "both"; version?: string } | undefined {
  const appVersion = app?.ready ?? app?.latest;
  const coreBehind = status?.behind && !(status.source === "app" && inApp && !coreElsewhere) ? status : undefined;
  if ((appVersion || coreBehind) && coreElsewhere && inApp)
    return {
      target: "both",
      version: appVersion ?? (coreBehind?.source === "release" ? coreBehind.latest : undefined),
    };
  if (appVersion) return { target: "app", version: appVersion };
  if (coreBehind) return { target: "core", version: coreBehind.source === "git" ? undefined : coreBehind.latest };
  return undefined;
}
