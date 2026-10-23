import type { ArtifactBundle, ArtifactMemory, Params } from "@apx/protocol";
import { ARTIFACT_FILE_EXT } from "@apx/protocol/client";
import { t } from "../i18n/index.ts";
import type { BridgeMethod } from "../surfaces/srcdoc.ts";
import { client } from "./client.ts";
import { notify } from "./notices.ts";
import { data } from "./state.ts";

// An artifact's own memory (store, db), its bundle file and the page's calls through the host bridge.

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A page's bridge call; the core checks the params against the method's schema, the host fixed the surface id. */
export function artifactCall(method: BridgeMethod, params: Record<string, unknown>): Promise<unknown> {
  return client.call(method, params as Params<BridgeMethod>);
}

export async function artifactMemory(id: string): Promise<ArtifactMemory | undefined> {
  try {
    return await client.call("surfaces.memory", { surface: id });
  } catch (e) {
    notify(t("artifact.memoryError", { error: errText(e) }));
    return undefined;
  }
}

export type MemoryPart = "state" | "store" | "db" | "secrets";

export async function clearArtifactMemory(id: string, parts: MemoryPart[]): Promise<ArtifactMemory | undefined> {
  try {
    const memory = await client.call("surfaces.memory_clear", { surface: id, parts });
    // A running page sees its state cleared without a reload (surfaceStates feeds every open frame).
    if (parts.includes("state")) data.set((s) => ({ surfaceStates: { ...s.surfaceStates, [id]: {} } }));
    return memory;
  } catch (e) {
    notify(t("artifact.memoryError", { error: errText(e) }));
    return undefined;
  }
}

/** Saves the artifact as `<name>.apx-artifact.json`; its memory only when asked. */
export async function exportArtifact(id: string, memory: boolean): Promise<boolean> {
  try {
    const bundle = await client.call("surfaces.export", { surface: id, memory });
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bundle.manifest.name}${ARTIFACT_FILE_EXT}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (e) {
    notify(t("artifact.exportError", { error: errText(e) }));
    return false;
  }
}

/** Installs an `.apx-artifact.json` file as a new artifact of the project (none: global). */
/** Installs an artifact file here: into `projectId` (none: global), pinned to Apps or not. */
export async function installArtifact(
  bundle: ArtifactBundle,
  projectId: string | undefined,
  pin: boolean,
): Promise<string | undefined> {
  try {
    let summary = await client.call("surfaces.import", { bundle, ...(projectId ? { project: projectId } : {}) });
    if (summary.app !== pin) summary = await client.call("surfaces.update", { surface: summary.id, app: pin });
    data.set((s) => ({ surfaces: { ...s.surfaces, [summary.id]: summary } }));
    notify(t("artifact.imported", { title: summary.title }), "info");
    return summary.id;
  } catch (e) {
    notify(t("artifact.importError", { error: errText(e) }));
    return undefined;
  }
}
