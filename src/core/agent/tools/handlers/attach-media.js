// attach_media — queue one of a skill's images to ride along with the message
// this run delivers (web + Telegram). The model does not need to SEE the image
// to send it: the skill's manifest (id → caption) is in the prompt, the model
// picks an id, and the runner hands the file to the delivery adapters.
//
// The set of attachable images is precomputed by the runner from the agent's
// declared skills (ctx.attachableMedia) so this handler never guesses at the
// filesystem, and a queued attachment lands in ctx.mediaSink for the runner to
// read after the loop finishes.
export default {
  name: "attach_media",
  schema: {
    type: "function",
    function: {
      name: "attach_media",
      description:
        "Attach one of your skill's images to the message this run delivers (shown in web chat and sent as a Telegram photo). Pass the image id from the skill's manifest. Optionally add a caption; otherwise the message text is used. Call once per image.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "image id from the skill manifest (read_skill / the prompt lists them)" },
          skill: { type: "string", description: "optional skill slug to disambiguate when two skills share an id" },
          caption: { type: "string", description: "optional caption for this image" },
        },
        required: ["id"],
      },
    },
  },
  makeHandler: (ctx = {}) => ({ id, skill, caption } = {}) => {
    if (!id) throw new Error("attach_media: id required");
    const pool = Array.isArray(ctx.attachableMedia) ? ctx.attachableMedia : [];
    if (!pool.length) {
      return { error: "no attachable images — this agent's skills declare none." };
    }
    const want = String(id).trim();
    const matches = pool.filter((m) => m.id === want && (!skill || m.skill === skill));
    if (!matches.length) {
      return {
        error: `no image "${want}"${skill ? ` in skill ${skill}` : ""}.`,
        available: pool.map((m) => ({ id: m.id, skill: m.skill, caption: m.caption })),
      };
    }
    const item = matches[0];
    const sink = Array.isArray(ctx.mediaSink) ? ctx.mediaSink : null;
    if (!sink) {
      // Delivery isn't wired for this invocation (e.g. a direct engine call with
      // no runner collecting attachments). Say so instead of pretending it sent.
      return { ok: false, error: "media delivery is not available on this channel." };
    }
    // Idempotent: attaching the same id twice sends one image.
    if (!sink.some((m) => m.path === item.path)) {
      sink.push({ id: item.id, skill: item.skill, path: item.path, mime: item.mime, caption: caption || item.caption || "" });
    }
    return { ok: true, id: item.id, skill: item.skill, note: `image "${item.id}" queued for delivery.` };
  },
};
