// voice_replies — turn spoken replies on or off for this conversation, now.
//
// The owner says "mandame audio" or "ahora mandame texto" and means THIS reply,
// not the next one. Nothing here answers them; the tool flips the switch and
// the turn goes on to write whatever it was going to write, which then leaves
// in the new shape. Saying "sure, from now on I'll send audio" in text and then
// sending it as text is the failure this exists to avoid.
//
// The override lives for the conversation, not forever: asking mid-chat is a
// "for now", and the standing preference belongs to the settings toggle
// (voice.voice_replies). Passing `reset` gives the thread back to it.
import { CHANNELS } from "#core/constants/channels.js";
import {
  setVoiceReplyOverride,
  clearVoiceReplyOverride,
  voiceReplyOverride,
  voiceRepliesConfigured,
} from "#core/voice/reply-mode.js";

/**
 * Which conversation this is. Telegram threads are per chat; everywhere else
 * the channel is the thread, so a preference set in the desktop does not follow
 * the owner into WhatsApp.
 */
export function threadKey(ctx = {}) {
  const channel = ctx.channel || "unknown";
  if (channel === CHANNELS.TELEGRAM) {
    const chat = ctx?.channelMeta?.chatId ?? ctx?.channelMeta?.chat_id;
    return chat ? `telegram:${chat}` : "telegram";
  }
  return channel;
}

export default {
  name: "voice_replies",
  schema: {
    type: "function",
    function: {
      name: "voice_replies",
      description:
        "Turn spoken replies on or off for this conversation, taking effect on the reply you are writing right now. " +
        "Call it when the owner asks to be sent audio or to stop being sent audio — then just answer normally; " +
        "the answer itself goes out in the new shape, so do not promise a change for 'next time'. " +
        "With audio on, the opening of each reply is sent as a voice note and the full text follows as usual.",
      parameters: {
        type: "object",
        properties: {
          on: { type: "boolean", description: "true = send audio, false = text only" },
          reset: { type: "boolean", description: "forget this conversation's choice and follow the configured default" },
        },
      },
    },
  },
  makeHandler: (ctx = {}) => ({ on, reset } = {}) => {
    const key = threadKey(ctx);
    if (reset) {
      clearVoiceReplyOverride(key);
      const back = voiceRepliesConfigured(ctx.globalConfig);
      return { ok: true, voice_replies: back, source: "default" };
    }
    if (typeof on !== "boolean") {
      // Not an error worth a retry: tell the model what it is now and move on.
      const current = voiceReplyOverride(key) ?? voiceRepliesConfigured(ctx.globalConfig);
      return { ok: true, voice_replies: current, note: "pass on:true or on:false to change it" };
    }
    setVoiceReplyOverride(key, on);
    return { ok: true, voice_replies: on, source: "asked" };
  },
};
