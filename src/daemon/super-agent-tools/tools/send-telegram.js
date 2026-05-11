import { confirmedProperty } from "../helpers.js";

function decodePhoto({ photo_base64, photo_path, photo_url }) {
  if (photo_url)  return String(photo_url);
  if (photo_path) return String(photo_path);
  if (photo_base64) {
    // Strip "data:image/...;base64," prefix if present
    const clean = String(photo_base64).replace(/^data:image\/[a-z]+;base64,/, "");
    return Buffer.from(clean, "base64");
  }
  return null;
}

export default {
  name: "send_telegram",
  schema: {
    type: "function",
    function: {
      name: "send_telegram",
      description:
        "Send a Telegram message via the daemon's Telegram plugin. Text only by default; pass photo_base64 (from browser_screenshot) / photo_path / photo_url to attach an image — the text becomes the caption. Use this AFTER a browser_screenshot when the user asks for a screenshot or visual reply.",
      parameters: {
        type: "object",
        properties: {
          channel:      { type: "string", description: "telegram channel name; omit for default" },
          chat_id:      { type: "string", description: "destination chat id; omit to use channel default" },
          text:         { type: "string", description: "message body (becomes the photo caption when a photo_* arg is passed)" },
          photo_base64: { type: "string", description: "raw base64 PNG/JPG (or 'data:image/...;base64,...' data URI). Pass the `base64` field returned by browser_screenshot here." },
          photo_path:   { type: "string", description: "absolute filesystem path to an image file" },
          photo_url:    { type: "string", description: "public https URL of an image" },
          confirmed:    confirmedProperty("true only after explicit user confirmation for this exact outbound message"),
        },
        required: ["text"],
      },
    },
  },
  makeHandler: ({ plugins, requirePermission }) => async ({ channel, chat_id, text, photo_base64, photo_path, photo_url, confirmed = false }) => {
    requirePermission("send_telegram", { dangerous: true, confirmed });
    if (!plugins) throw new Error("plugins unavailable");
    const telegram = plugins.get("telegram");
    if (!telegram) throw new Error("telegram plugin not loaded");

    const photo = decodePhoto({ photo_base64, photo_path, photo_url });
    if (photo) {
      const result = await telegram.sendPhoto({
        channel, chat_id, photo, caption: text, author: "apx",
      });
      return { ok: true, kind: "photo", message_id: result.message_id };
    }

    const result = await telegram.send({ channel, chat_id, text, author: "apx" });
    return { ok: true, kind: "text", message_id: result.message_id };
  },
};
