// What the daily usage report counts as it happens: nothing before the owner's yes, nothing after a no, and only
// numbers and the ids of extensions anyone can see in a public catalog. See rules/DECISIONS.md#d-257.
import {
  type ExtensionInfo,
  USAGE_EXTENSIONS_MAX,
  type UsageCount,
  UsageExtension,
  type UsageStats,
} from "@apx/protocol";
import type { Store } from "./domain/store.ts";

/** Adds one to `name`, and the extension's id to the day's list, only while the owner's answer is yes. */
export function countUsage(store: Store, name: UsageCount, extension?: string): void {
  const s = store.settings.read("telemetry");
  if (s.usage !== true) return;
  const listed = extension && UsageExtension.safeParse(extension).success && s.extensions.length < USAGE_EXTENSIONS_MAX;
  store.settings.write("telemetry", {
    ...s,
    counts: { ...s.counts, [name]: (s.counts[name] ?? 0) + 1 },
    ...(listed ? { extensions: [...s.extensions, extension] } : {}),
  });
}

/** How an extension was installed, as the protocol call gave it. */
export type InstallFrom = { path?: unknown; file?: unknown; url?: unknown; entry?: unknown; server?: unknown };

/**
 * Counts one install by where it came from. Its id goes along only when anyone can see it: listed by APX's catalog
 * (official by its files) or by a public catalog APX suggests. A folder, file, URL or private catalog is a count.
 */
export function countInstall(store: Store, from: InstallFrom, info: ExtensionInfo, publicCatalog: boolean): void {
  const version = UsageExtension.safeParse(`x@${info.version}`).success ? `@${info.version}` : "";
  const id = `${info.id}${version}`;
  const [kind, shown]: [UsageCount, string | undefined] =
    from.server !== undefined
      ? ["installs_server", undefined]
      : info.provenance === "official"
        ? ["installs_official", id]
        : from.entry !== undefined
          ? ["installs_catalog", publicCatalog ? id : undefined]
          : from.file !== undefined
            ? ["installs_file", undefined]
            : from.url !== undefined
              ? ["installs_url", undefined]
              : ["installs_folder", undefined];
  countUsage(store, kind, shown);
}

/** The counts kept since the last report, as the report carries them: only what happened, so a quiet day adds nothing. */
export function usageCounts(store: Store): Pick<UsageStats, UsageCount | "extensions"> {
  const s = store.settings.read("telemetry");
  return { ...s.counts, ...(s.extensions.length ? { extensions: [...s.extensions] } : {}) };
}

/** Takes what a report carried off the counts, keeping whatever was counted while it was on its way. */
export function settleUsageCounts(store: Store, sent: Pick<UsageStats, UsageCount | "extensions">): void {
  const s = store.settings.read("telemetry");
  const counts: typeof s.counts = {};
  for (const [k, v] of Object.entries(s.counts) as Array<[UsageCount, number]>) {
    const left = v - (sent[k] ?? 0);
    if (left > 0) counts[k] = left;
  }
  store.settings.write("telemetry", { ...s, counts, extensions: s.extensions.slice(sent.extensions?.length ?? 0) });
}
