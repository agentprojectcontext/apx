// A folder (files.*), a project's or a chat's: browse, read, preview media and the owner's actions on a file.
import type { Result } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { notify } from "./notices.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type MediaKind = "image" | "video" | "audio" | "pdf";
const KINDS: Record<string, MediaKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  avif: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  m4a: "audio",
  pdf: "pdf",
};
/** What the viewer can show of a file, by its extension (as the core decides). */
export const mediaKind = (path: string): MediaKind | undefined => KINDS[path.split(".").pop()?.toLowerCase() ?? ""];

/**
 * Whose folder a file is in: a project's, the base project's (APX's work folder), the one a chat works in, or
 * (`scratch`) that chat's temp folder.
 */
export type FileWhere = { project: string } | { base: true } | { thread: string; scratch?: boolean };

/** An object URL for a previewable file (the caller revokes it) and its size. */
export async function mediaOf(where: FileWhere, path: string): Promise<{ url: string; bytes: number }> {
  const m: Result<"files.media"> = await client.call("files.media", { ...where, path });
  const bytes = Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0));
  return { url: URL.createObjectURL(new Blob([bytes], { type: m.mime })), bytes: m.bytes };
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
/**
 * Whether the core runs on the computer showing the panel: only then can Finder show its files. The desktop app knows;
 * a browser (or an older app) guesses from the address.
 */
export const coreOnThisComputer = (): boolean =>
  window.apxDesktop?.coreLocal ?? (LOOPBACK.has(location.hostname) || location.hostname.endsWith(".localhost"));

/** Saves a file of the core's on this computer, wherever the core runs. */
export async function downloadFile(where: FileWhere, path: string): Promise<void> {
  try {
    const f = await client.call("files.download", { ...where, path });
    const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (e) {
    notify(t("files.error", { error: errText(e) }));
  }
}

export async function revealFile(where: FileWhere, path: string): Promise<void> {
  try {
    await client.call("files.reveal", { ...where, path });
  } catch (e) {
    notify(t("files.error", { error: errText(e) }));
  }
}

/** Opens a text document in its default app on the core's computer. */
export async function openFile(where: FileWhere, path: string): Promise<void> {
  try {
    await client.call("files.open", { ...where, path });
  } catch (e) {
    notify(t("files.error", { error: errText(e) }));
  }
}

/** The new relative path, or undefined when the core refused. */
export async function renameFile(where: FileWhere, path: string, name: string): Promise<string | undefined> {
  try {
    return (await client.call("files.rename", { ...where, path, name })).path;
  } catch (e) {
    notify(t("files.error", { error: errText(e) }));
    return undefined;
  }
}

export async function trashFile(where: FileWhere, path: string): Promise<boolean> {
  try {
    await client.call("files.trash", { ...where, path });
    notify(t("files.trashed", { name: path.split("/").pop() ?? path }), "info");
    return true;
  } catch (e) {
    notify(t("files.error", { error: errText(e) }));
    return false;
  }
}

/** Copies a temp file into the chat's folder, where it stays; the copy's path, or undefined when the core refused. */
export async function keepFile(thread: string, path: string): Promise<string | undefined> {
  try {
    const kept = (await client.call("files.keep", { thread, path })).path;
    notify(t("files.kept", { path: kept }), "info");
    return kept;
  } catch (e) {
    notify(t("files.error", { error: errText(e) }));
    return undefined;
  }
}
