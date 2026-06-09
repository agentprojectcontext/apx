import { confirmedProperty } from "../helpers.js";

function decodeBase64(b64) {
  const clean = String(b64).replace(/^data:[a-z/-]+;base64,/, "");
  return Buffer.from(clean, "base64");
}

function decodePhoto({ photo_base64, photo_path, photo_url }) {
  if (photo_url)    return String(photo_url);
  if (photo_path)   return String(photo_path);
  if (photo_base64) return decodeBase64(photo_base64);
  return null;
}

function decodeDocument({ document_base64, document_path, document_url }) {
  if (document_url)    return String(document_url);
  if (document_path)   return String(document_path);
  if (document_base64) return decodeBase64(document_base64);
  return null;
}

/**
 * Detect the common LLM mistake of embedding raw base64 in the text field
 * (often wrapped in markdown image syntax). Telegram does NOT render those —
 * it just shows the literal characters. Fail fast with a clear hint.
 */
function detectBase64InText(text) {
  if (!text || typeof text !== "string") return null;
  if (/!\[[^\]]*\]\(data:image\/[a-z]+;base64,/i.test(text)) {
    return "markdown image with data URI";
  }
  if (/data:image\/[a-z]+;base64,/i.test(text)) {
    return "data URI";
  }
  // Long runs of base64-looking chars (>500 contiguous) — almost certainly a
  // dumped image
  if (/[A-Za-z0-9+/=]{500,}/.test(text)) {
    return "raw base64 blob (>500 chars)";
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
        "Send a Telegram message via the daemon's Telegram plugin. STRICT rule: to attach an image use the photo_* params; to attach a file use the document_* params — NEVER paste base64 or a data URI inside `text` (Telegram does not render markdown images / data URIs, the recipient sees the literal base64). After browser_screenshot, pass its `base64` field directly to photo_base64 here (not in text). The text field becomes the caption when media is attached.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", description: "telegram channel name; omit for default" },
          chat_id: { type: "string", description: "destination chat id; omit to use channel default" },
          text: {
            type: "string",
            description:
              "Plain-text body (becomes the caption when a photo_* or document_* is attached). MUST NOT contain base64, data URIs, or markdown image syntax like ![](data:...) — use photo_base64 for that.",
          },
          // --- image attachments ---
          photo_base64: {
            type: "string",
            description:
              "raw base64 PNG/JPG (or 'data:image/...;base64,...'). Pass the `base64` field from browser_screenshot directly here.",
          },
          photo_path: { type: "string", description: "absolute filesystem path to an image file" },
          photo_url:  { type: "string", description: "public https URL of an image" },
          // --- document attachments (PDF, txt, zip, etc) ---
          document_base64: { type: "string", description: "raw base64 of a file" },
          document_path:   { type: "string", description: "absolute filesystem path to any file (PDF, txt, zip, .csv...)" },
          document_url:    { type: "string", description: "public https URL of a file" },
          filename:        { type: "string", description: "filename to show in Telegram when sending a document (Buffer-style input)" },
          mime_type:       { type: "string", description: "optional MIME type for the document" },
          confirmed: confirmedProperty("true only after explicit user confirmation for this exact outbound message"),
        },
        required: ["text"],
      },
    },
  },
  makeHandler: ({ plugins, requirePermission }) => async (args = {}) => {
    const {
      channel, chat_id, text,
      photo_base64, photo_path, photo_url,
      document_base64, document_path, document_url,
      filename, mime_type,
      confirmed = false,
    } = args;

    await requirePermission("send_telegram", { dangerous: true, confirmed, args: { text } });
    if (!plugins) throw new Error("plugins unavailable");
    const telegram = plugins.get("telegram");
    if (!telegram) throw new Error("telegram plugin not loaded");

    // Defensive: catch the classic mistake of dumping base64 into text.
    const bad = detectBase64InText(text);
    if (bad) {
      throw new Error(
        `send_telegram: refusing to send — text appears to contain ${bad}. ` +
        `Telegram does not render data URIs or markdown images. ` +
        `Pass the base64 in photo_base64 (NOT text). Set text to a short caption like "Captura de localhost:8801".`
      );
    }

    const photo = decodePhoto({ photo_base64, photo_path, photo_url });
    if (photo) {
      const result = await telegram.sendPhoto({
        channel, chat_id, photo, caption: text, author: "apx",
      });
      return { ok: true, kind: "photo", message_id: result.message_id };
    }

    const document = decodeDocument({ document_base64, document_path, document_url });
    if (document) {
      const result = await telegram.sendDocument({
        channel, chat_id, document, caption: text, filename, mime_type,
      });
      return { ok: true, kind: "document", message_id: result.message_id, filename };
    }

    const result = await telegram.send({ channel, chat_id, text });
    return { ok: true, kind: "text", message_id: result.message_id };
  },
};
