import { confirmedProperty } from "../helpers.js";

export default {
  name: "send_telegram",
  schema: {
    type: "function",
    function: {
      name: "send_telegram",
      description: "Send a Telegram message via the daemon's Telegram plugin.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", description: "telegram channel name; omit for default" },
          chat_id: { type: "string", description: "destination chat id; omit to use channel default" },
          text: { type: "string" },
          confirmed: confirmedProperty("true only after explicit user confirmation for this exact outbound message"),
        },
        required: ["text"],
      },
    },
  },
  makeHandler: ({ plugins, requirePermission }) => async ({ channel, chat_id, text, confirmed = false }) => {
    requirePermission("send_telegram", { dangerous: true, confirmed });
    if (!plugins) throw new Error("plugins unavailable");
    const telegram = plugins.get("telegram");
    if (!telegram) throw new Error("telegram plugin not loaded");
    const result = await telegram.send({ channel, chat_id, text, author: "apx" });
    return { ok: true, message_id: result.message_id };
  },
};
