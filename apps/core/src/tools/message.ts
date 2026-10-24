// message_contact: the owner's agent writes to one of the owner's contacts on a channel ("tell Alex on WhatsApp…"),
// or to the owner there ("send me the quote"); channel_post posts in a room of a channel ("put it in #help"). Both
// with files if asked, as v1's send_whatsapp and send_file did.
// Contacts' own turns never get them (see CONTACT_TOOLS in turn.ts): a contact cannot make the agent write to someone.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { OWNER_ID } from "../domain/persons.ts";
import type { Store } from "../domain/store.ts";
import { channelsOn } from "./directory.ts";
import { folderAccess, readsOutside, workDir } from "./folders.ts";
import { untrusted } from "./result.ts";
import { defineTool, type Tool, type ToolContext } from "./types.ts";

/** Largest file sent in one message (the channels take more; a bigger one is not something to send unasked). */
const MAX_FILE = 20 * 1024 * 1024;
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
};

/** How the send went, in words the agent must pass on as they are. */
function outcome(to: string, channel: string, d: { state: string; error?: string | undefined }, with_: string): string {
  const why = d.error ? ` (${channel} said: ${d.error.slice(0, 200)})` : "";
  if (d.state === "sent") return `sent to ${to} on ${channel}${with_}.`;
  if (d.state === "failed")
    return `NOT sent to ${to}: ${channel} refused it${why}. Tell the owner it did not go out and why; do not retry the same send.`;
  if (d.state === "uncertain")
    return `maybe not sent to ${to} on ${channel}${why}: tell the owner to check it; do not send it again.`;
  return `queued for ${to}: ${channel} has not taken it yet${why}; it goes out when the channel can. Say so, not that it went.`;
}

/** What a send left, with the end of that chat (outside words, so framed as untrusted). */
function sentNote(
  to: string,
  r: {
    channel: string;
    recent: Array<{ from: string; text: string }>;
    delivery: { state: string; error?: string | undefined };
  },
  files: number,
  kind: string,
): string {
  const tail = r.recent.map((m) => `${m.from}: ${m.text}`).join("\n");
  const with_ = files ? ` with ${files} file${files > 1 ? "s" : ""}` : "";
  return `${outcome(to, r.channel, r.delivery, with_)}${tail ? `\nThe chat before it:\n${untrusted(kind, { with: to }, tail)}` : ""}`;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function messageTools(store: Store, home: string): Tool[] {
  /**
   * Files the agent may read, copied aside as media so what goes out is what was asked for. To the owner any of them
   * (DECISIONS.md#d-115); to anyone else only the folder it works in, never its temp folder or one it reads anywhere.
   */
  const attach = (ctx: ToolContext, files: string[], toOwner: boolean): { ids: string[] } | { problem: string } => {
    const base = workDir(store, home, ctx.thread);
    const ids: string[] = [];
    for (const file of files) {
      const where = folderAccess(store, home, ctx.thread, file);
      if ("refused" in where) return { problem: where.refused };
      if (where.at.split(/[\\/]/).includes(".git")) return { problem: "the .git folder is off limits" };
      if (!toOwner && where.base !== base)
        return { problem: `${file} is not in the folder you work in: copy it there to send it` };
      const { at } = where;
      if (!fs.existsSync(at) || !fs.statSync(at).isFile()) return { problem: `no file ${file}` };
      const bytes = fs.statSync(at).size;
      if (bytes > MAX_FILE) return { problem: `${file} is over ${MAX_FILE / 1024 / 1024} MB` };
      const ext = path.extname(at).slice(1).toLowerCase();
      const mime = MIME[ext] ?? "application/octet-stream";
      const kind = mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : "file";
      const dir = path.join(home, "media", "sent", new Date().toISOString().slice(0, 10));
      fs.mkdirSync(dir, { recursive: true });
      const copy = path.join(dir, `${randomUUID()}${ext ? `.${ext}` : ""}`);
      fs.copyFileSync(at, copy);
      ids.push(
        store.media.add({ kind, mime, bytes, path: copy, thread_id: ctx.thread.id, prompt: path.basename(at) }).id,
      );
    }
    return { ids };
  };
  /** The owner's contact a name (or id) points at ("me": the owner); several or none: why, with the names there are. */
  const resolve = (to: string): { id: string; name: string } | { problem: string } => {
    if (/^(me|owner|yo|a mi|a mí)$/i.test(to.trim())) {
      const owner = store.persons.get(OWNER_ID);
      if (owner) return owner;
    }
    const contacts = store.persons.list().filter((p) => p.role === "contact");
    const exact = contacts.find((p) => p.id === to);
    if (exact) return exact;
    const q = norm(to);
    const whole = contacts.filter((p) => norm(p.name) === q || (p.nickname && norm(p.nickname) === q));
    const part = whole.length
      ? whole
      : contacts.filter((p) =>
          norm(p.name)
            .split(/\s+/)
            .some((w) => w === q || w.startsWith(q)),
        );
    if (part.length === 1 && part[0]) return part[0];
    if (part.length > 1)
      return { problem: `"${to}" matches ${part.map((p) => `${p.name} (${p.id})`).join(", ")}: say which one` };
    return {
      problem: `no contact named "${to}". Contacts: ${
        contacts
          .slice(0, 30)
          .map((p) => p.name)
          .join(", ") || "none"
      }`,
    };
  };
  return [
    defineTool({
      name: "message_contact",
      description:
        'Send a message to a person on the owner\'s channels: a contact (\'tell Alex…\') or the owner (to="me"). to: a name, id or "me"; channel: default where they last talked; files: paths in your work folder, any file you can read for to="me" (20 MB at most). Plain text, no Markdown, in first person as the owner\'s assistant, only what the owner asked for. Once sent it cannot be taken back; the result shows the end of that chat: check it before saying it went.',
      args: z.object({
        to: z.string().trim().min(1).max(120),
        text: z.string().trim().min(1).max(4000),
        channel: z.string().max(60).optional(),
        files: z.array(z.string().min(1).max(500)).max(5).optional(),
      }),
      effect: "message",
      when: () => channelsOn(store),
      // Words go to someone else: asked while outside content is in the turn, unless the agent's autonomy is total.
      confirm: "untrusted",
      outside: (a, ctx) => readsOutside(store, home, ctx.thread, (a.files as string[] | undefined) ?? []),
      deadlineMs: 15_000,
      title: (a) => `Wrote to ${String(a.to ?? "a contact")}`,
      async run(a, ctx) {
        if (a.to.trim().startsWith("#")) return `not sent: ${a.to} is a room, not a person; use channel_post`;
        const who = resolve(a.to);
        if ("problem" in who) return `not sent: ${who.problem}`;
        const files = a.files?.length ? attach(ctx, a.files, who.id === OWNER_ID) : { ids: [] };
        if ("problem" in files) return `not sent: ${files.problem}`;
        const r = await ctx.call("channels.message", {
          person: who.id,
          text: a.text,
          ...(a.channel ? { channel: a.channel } : {}),
          ...(files.ids.length ? { files: files.ids } : {}),
        });
        return sentNote(who.name, r, files.ids.length, "contact_chat");
      },
    }),
    defineTool({
      name: "channel_post",
      description:
        "Post in a room of the owner's channels (a Discord #channel); rooms are public. room: its name as channel_list shows it; channel: only when two channels have a room of that name; files: paths in your work folder (20 MB at most). Plain text, no Markdown, no @everyone; mention someone with their @handle as read_chat shows it. Only what the owner asked for; once posted it cannot be taken back.",
      args: z.object({
        room: z.string().trim().min(1).max(80),
        text: z.string().trim().min(1).max(4000),
        channel: z.string().max(60).optional(),
        files: z.array(z.string().min(1).max(500)).max(5).optional(),
      }),
      effect: "message",
      when: () => channelsOn(store),
      // A public post: asked while outside content is in the turn, unless the agent's autonomy is total.
      confirm: "untrusted",
      deadlineMs: 15_000,
      title: (a) => `Posted in #${String(a.room ?? "a room").replace(/^#/, "")}`,
      async run(a, ctx) {
        const files = a.files?.length ? attach(ctx, a.files, false) : { ids: [] };
        if ("problem" in files) return `not posted: ${files.problem}`;
        const r = await ctx.call("channels.post", {
          room: a.room,
          text: a.text,
          ...(a.channel ? { channel: a.channel } : {}),
          ...(files.ids.length ? { files: files.ids } : {}),
        });
        return sentNote(`#${a.room.replace(/^#/, "")}`, r, files.ids.length, "room_chat");
      },
    }),
  ];
}
