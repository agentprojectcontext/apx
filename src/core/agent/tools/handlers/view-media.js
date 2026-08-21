// view_media — load one of a skill's images INTO the agent's own context so it
// can reason about it (a swing position, a grip, a course diagram). The image
// manifest (id → caption) rides in the prompt for ~nothing; the pixels are
// pulled only when the agent asks, on the turn it asks — the same
// pay-as-you-go rule as read_skill for text.
//
// The bytes come back as base64 in an `images` field. run-agent.js lifts that
// off the JSON result and onto the tool message so a vision engine (Gemini)
// renders it as an inlineData part; text engines simply ignore it and see the
// caption. Nothing base64 ever lands in the transcript text.
import fs from "node:fs";

// A guard so a huge asset can't blow the turn's token budget. ~5 MB of base64
// is already a lot for one image; above that, tell the model to pick another.
const MAX_BYTES = 5 * 1024 * 1024;

export default {
  name: "view_media",
  schema: {
    type: "function",
    function: {
      name: "view_media",
      description:
        "Load one of your skill's images into your own context so you can see and reason about it (a position, a grip, a diagram). Pass the image id from the skill manifest. Only call this when you actually need to look — to attach an image to your reply, use attach_media instead.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "image id from the skill manifest" },
          skill: { type: "string", description: "optional skill slug to disambiguate a shared id" },
        },
        required: ["id"],
      },
    },
  },
  makeHandler: (ctx = {}) => ({ id, skill } = {}) => {
    if (!id) throw new Error("view_media: id required");
    const pool = Array.isArray(ctx.attachableMedia) ? ctx.attachableMedia : [];
    if (!pool.length) return { error: "no images available for this agent's skills." };

    const want = String(id).trim();
    const matches = pool.filter((m) => m.id === want && (!skill || m.skill === skill));
    if (!matches.length) {
      return {
        error: `no image "${want}"${skill ? ` in skill ${skill}` : ""}.`,
        available: pool.map((m) => ({ id: m.id, skill: m.skill, caption: m.caption })),
      };
    }
    const item = matches[0];
    let buf;
    try {
      buf = fs.readFileSync(item.path);
    } catch (e) {
      return { error: `could not read image "${want}": ${e?.message || e}` };
    }
    if (buf.length > MAX_BYTES) {
      return {
        error: `image "${want}" is ${(buf.length / 1048576).toFixed(1)} MB, over the ${(MAX_BYTES / 1048576).toFixed(0)} MB view limit.`,
      };
    }
    return {
      ok: true,
      id: item.id,
      skill: item.skill,
      caption: item.caption || "",
      note: `Loaded image "${item.id}" — described in the caption and shown to you now.`,
      images: [{ data: buf.toString("base64"), mime: item.mime || "image/jpeg" }],
    };
  },
};
