// send_file — hand the owner a file from disk (a screenshot, an image it
// generated, a render). The file rides with the reply this turn delivers: it
// shows in the web chat with a download link and goes out as a Telegram photo
// or document.
//
// The model never has to push bytes through its context. It names a path; the
// handler checks it against the delivery policy (core/stores/file-delivery.js:
// the owner's per-kind switches, plus the executables and credential folders
// that are never sent) and queues it on ctx.mediaSink — the same sink
// attach_media fills, which the caller archives and delivers after the loop.
import os from "node:os";
import path from "node:path";
import { checkDeliverable, deliveryPolicy, allowedKinds } from "#core/stores/file-delivery.js";

function resolvePath(raw, ctx) {
  let p = String(raw || "").trim();
  if (!p) return null;
  if (p === "~" || p.startsWith("~/")) p = path.join(os.homedir(), p.slice(1));
  if (path.isAbsolute(p)) return path.normalize(p);
  // A relative path means the project this turn stands in — never the daemon's
  // own cwd, which is the apx checkout.
  const base = ctx?.channelMeta?.projectPath;
  return base ? path.resolve(base, p) : null;
}

export default {
  name: "send_file",
  schema: {
    type: "function",
    function: {
      name: "send_file",
      description:
        "Send the owner a file from disk — it arrives with your reply (web chat with a download link, Telegram as a photo/document). " +
        "Use it whenever you produced something the owner should SEE: a browser screenshot (take it with save_to_tmp: true, then pass the returned path), a generated image, a render. " +
        "Only kinds the owner enabled are accepted (images by default); executables and credential folders are always refused. " +
        "Never claim you sent a file unless this returned ok: true. Call once per file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "absolute path to the file (or relative to the current project)" },
          caption: { type: "string", description: "optional caption shown with the file" },
          name: { type: "string", description: "optional file name to show instead of the one on disk" },
        },
        required: ["path"],
      },
    },
  },
  makeHandler: (ctx = {}) => ({ path: raw, caption, name } = {}) => {
    const abs = resolvePath(raw, ctx);
    if (!abs) return { ok: false, error: "send_file: an absolute path is required" };

    const policy = deliveryPolicy(ctx.globalConfig);
    const check = checkDeliverable(abs, policy);
    if (!check.ok) return { ok: false, error: check.reason, allowed_kinds: allowedKinds(policy) };

    const sink = Array.isArray(ctx.mediaSink) ? ctx.mediaSink : null;
    if (!sink) {
      // No caller is collecting attachments on this invocation. Say so rather
      // than let the model tell the owner a file is on its way.
      return { ok: false, error: "file delivery is not available on this channel." };
    }
    // Idempotent: sending the same file twice delivers it once.
    if (!sink.some((m) => m.path === check.path)) {
      sink.push({
        path: check.path,
        mime: check.mime,
        kind: check.media_kind,
        file: name ? String(name) : path.basename(check.path),
        caption: caption ? String(caption) : "",
      });
    }
    return {
      ok: true,
      file: path.basename(check.path),
      kind: check.kind,
      size: check.size,
      note: "queued — it is delivered together with your reply.",
    };
  },
};
