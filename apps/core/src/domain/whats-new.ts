// What an update brought, told by the super-agent: on the first start of a newer release, a chat of its own, unread,
// with each new release's changes. Written from the notes the build carries (no model call); asking about them there
// is an ordinary turn. See DECISIONS.md#d-100 and #d-117
import { compareVersions, type Release, type ReleaseNotes, type ReleaseSource } from "../release-notes.ts";
import type { Store } from "./store.ts";
import { previewOf } from "./threads.ts";

/** The last release this install was told about (or started on). */
const SEEN_KEY = "release_seen";
/** The chat the release news goes in. */
const THREAD_KEY = "whats_new_thread";
const PER_SECTION = 25;

// Always English: the notes are commit sentences, and a frame in another language around them reads broken.
const WORDS = {
  title: (v: string) => `What's new in APX ${v}`,
  intro: (v: string) => `APX was updated to ${v}. This is what changed:`,
  sections: { feat: "New", fix: "Fixed", perf: "Faster" },
  more: (n: number) => `…and ${n} more`,
  internal: "Internal changes only.",
  outro: "Ask me anything about these changes.",
};

function releaseText(r: Release, w = WORDS): string {
  const blocks = (["feat", "fix", "perf"] as const).flatMap((kind) => {
    const lines = r.changes.filter((c) => c.kind === kind).map((c) => `- ${c.text}`);
    if (!lines.length) return [];
    const more = lines.length - PER_SECTION;
    return [`**${w.sections[kind]}**\n${lines.slice(0, PER_SECTION).join("\n")}${more > 0 ? `\n${w.more(more)}` : ""}`];
  });
  return blocks.length ? blocks.join("\n\n") : w.internal;
}

/** The message: one release as it is, several (an install that skipped some) each under its version, newest first. */
export function whatsNewText(version: string, releases: Release[]): string {
  const w = WORDS;
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

  const text = whatsNewText(version, releases);
  const oldest = releases.at(-1);
  return store.tx(() => {
    // One chat for the news: each release goes on in it (retitled) instead of opening another.
    const kept = store.threads.get(store.settings.get(THREAD_KEY) ?? "");
    const thread =
      kept && !kept.archived && kept.agent_ids[0] === boss.id
        ? store.threads.patch(kept.id, { title: WORDS.title(version) })
        : store.threads.create({ kind: "agent", title: WORDS.title(version), agent_ids: [boss.id] });
    store.settings.set(THREAD_KEY, thread.id);
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
    store.threads.patch(thread.id, { preview: previewOf(text), unread: (thread.unread ?? 0) + 1 });
    store.settings.set(SEEN_KEY, version);
    return { thread: thread.id };
  });
}
