// What an update brought, told by the super-agent: on the first start of a newer release, a chat of its own, unread,
// with each new release's changes. Written from the notes the build carries (no model call); asking about them there
// is an ordinary turn. See DECISIONS.md#d-098
import { compareVersions, type Release, type ReleaseNotes, type ReleaseSource } from "../release-notes.ts";
import type { Store } from "./store.ts";
import { previewOf } from "./threads.ts";

/** The last release this install was told about (or started on). */
const SEEN_KEY = "release_seen";
const PER_SECTION = 25;

type Words = {
  title: (v: string) => string;
  intro: (v: string) => string;
  sections: Record<"feat" | "fix" | "perf", string>;
  more: (n: number) => string;
  internal: string;
  outro: string;
};

const WORDS: Record<"en" | "es", Words> = {
  en: {
    title: (v) => `What's new in APX ${v}`,
    intro: (v) => `APX was updated to ${v}. This is what changed:`,
    sections: { feat: "New", fix: "Fixed", perf: "Faster" },
    more: (n) => `…and ${n} more`,
    internal: "Internal changes only.",
    outro: "Ask me anything about these changes.",
  },
  es: {
    title: (v) => `Novedades de APX ${v}`,
    intro: (v) => `APX se actualizó a la versión ${v}. Esto es lo que cambió:`,
    sections: { feat: "Nuevo", fix: "Arreglado", perf: "Más rápido" },
    more: (n) => `…y ${n} más`,
    internal: "Solo cambios internos.",
    outro: "Preguntame lo que quieras sobre estos cambios.",
  },
};

function releaseText(r: Release, w: Words): string {
  const blocks = (["feat", "fix", "perf"] as const).flatMap((kind) => {
    const lines = r.changes.filter((c) => c.kind === kind).map((c) => `- ${c.text}`);
    if (!lines.length) return [];
    const more = lines.length - PER_SECTION;
    return [`**${w.sections[kind]}**\n${lines.slice(0, PER_SECTION).join("\n")}${more > 0 ? `\n${w.more(more)}` : ""}`];
  });
  return blocks.length ? blocks.join("\n\n") : w.internal;
}

/** The message: one release as it is, several (an install that skipped some) each under its version, newest first. */
export function whatsNewText(version: string, releases: Release[], language: string): string {
  const w = language === "es" ? WORDS.es : WORDS.en;
  const body =
    releases.length === 1 && releases[0]
      ? releaseText(releases[0], w)
      : releases.map((r) => `### ${r.version}\n\n${releaseText(r, w)}`).join("\n\n");
  return `${w.intro(version)}\n\n${body}\n\n${w.outro}`;
}

/** The releases after `seen` up to `version`, from what the build carries; with no `seen`, only `version`'s own. */
const newSince = (notes: ReleaseNotes, version: string, seen: string | undefined) =>
  notes.releases.filter((r) =>
    seen
      ? compareVersions(r.version, version) <= 0 && compareVersions(r.version, seen) > 0
      : compareVersions(r.version, version) === 0,
  );

/**
 * Tells the owner what this release brought, once per release. A new install (nothing said in it yet) starts at its
 * version untold; an install in use from before release notes existed is told this one.
 */
export function announceRelease(store: Store, source: ReleaseSource): { thread?: string } {
  const version = source.version();
  if (!version) return {};
  const seen = store.settings.get(SEEN_KEY);
  if (seen === version) return {};
  // A downgrade tells nothing and keeps the newest release told, so going back up is not told twice.
  if (seen && compareVersions(version, seen) <= 0) return {};
  const untold = () => {
    store.settings.set(SEEN_KEY, version);
    return {};
  };
  if (!seen && !store.messages.anyFromOwner()) return untold();
  const boss = store.agents.list().find((a) => a.kind === "secretary");
  const notes = source.notes();
  const releases = notes ? newSince(notes, version, seen) : [];
  if (!boss || !notes || !releases.length) return untold();

  const language = store.settings.get("owner_language") || "es";
  const text = whatsNewText(version, releases, language);
  const oldest = releases.at(-1);
  return store.tx(() => {
    const thread = store.threads.create({
      kind: "agent",
      title: (language === "es" ? WORDS.es : WORDS.en).title(version),
      agent_ids: [boss.id],
    });
    store.threads.mergeContext(thread.id, {
      release: {
        version,
        ...(oldest?.previous ? { previous: oldest.previous } : {}),
        ...(notes.branch ? { branch: notes.branch } : {}),
        ...(notes.repo_dir ? { repo_dir: notes.repo_dir } : {}),
      },
    });
    store.messages.add({
      thread_id: thread.id,
      author: { kind: "agent", id: boss.id },
      parts: [{ type: "text", text }],
    });
    // A history starts at a user item: a note of what happened opens it, then the agent's own words.
    store.modelLog.append(thread.id, undefined, [
      { role: "user", content: `[APX: APX was updated to ${version}; you posted what changed for the owner.]` },
      { role: "assistant", content: text },
    ]);
    store.threads.patch(thread.id, { preview: previewOf(text), unread: 1 });
    store.settings.set(SEEN_KEY, version);
    return { thread: thread.id };
  });
}
