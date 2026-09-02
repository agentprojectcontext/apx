// Telegram replies as VOICE while the owner is driving.
//
// The rule: when a trip is active, every automatic Telegram reply goes out
// twice — first the spoken note, then the same words as text under a
// transcript header. Two sends, deliberately. The audio is what you can
// consume with your eyes on the road; the text is what you can scroll back to
// at the next red light, and what search, the web panel and the ledger can
// read. Neither one alone covers both.
//
// Length is the other half of the feature and it is NOT handled here: a
// spoken paragraph is unusable, so the turn itself runs in voice MODE
// (channelMeta.voice → prompts/modes/voice.md, two short sentences), the same
// switch the desktop capsule already uses. This module only delivers what
// that produced. Trying to shorten text after the model wrote it would just
// truncate mid-sentence.
//
// Core stays core: the Telegram I/O arrives as `io` ({ send, sendVoice }), so
// nothing here imports the host plugin.
import fs from "node:fs";
import { t, resolveLang } from "#core/i18n/index.js";
import { synthesize } from "#core/voice/tts.js";
import { toVoiceNote } from "#core/voice/opus.js";
import { archiveOutboundMedia, outboundMediaMeta } from "#core/stores/media-archive.js";
import { mobilityContext } from "#core/mobility/state.js";

/**
 * Is the owner in a car right now, and does this install want spoken replies
 * for that? Trip state is the trigger; `config.voice.mobility_replies` is the
 * kill switch (default on — the feature is pointless if you have to arm it
 * before every drive, and the whole point is that you cannot safely touch the
 * phone once you have started).
 */
export function mobilityVoiceActive(globalConfig, state = mobilityContext()) {
  if (globalConfig?.voice?.mobility_replies === false) return false;
  return Boolean(state?.trip?.active);
}

/**
 * Send `text` as a voice note plus its transcript. Returns what actually
 * happened, so the caller can log the right thing:
 *
 *   { voice: true,  transcript, provider, media, sent }  — both went out
 *   { voice: false, reason }                             — TTS or ffmpeg
 *                                          failed; the caller still owes the text
 *
 * `sent` is the TEXT message's Telegram result, not the audio's: it is the one
 * carrying the inline keyboard, so it is the one a later edit has to address.
 *
 * The transcript send is the caller's business ONLY in the failure case: on
 * success this function has already sent both halves, keyboard included. That
 * asymmetry is on purpose — the keyboard must ride on the text message (a
 * voice note with chips under it reads as if the chips belong to the audio
 * player), and only this function knows whether the audio made it.
 *
 * `synthesizeFn` / `toVoiceNoteFn` are seams, not options: the same shape as
 * `ctx.mobilityFetch` elsewhere in this feature. Speech and ffmpeg are the two
 * things a test cannot have (the always-available mock engine returns silence,
 * which this function is required to refuse), and without them the two-send
 * contract would be untestable.
 */
export async function deliverVoiceReply({
  io, chat_id, text, reply_markup, globalConfig, log = () => {},
  synthesizeFn = synthesize, toVoiceNoteFn = toVoiceNote,
}) {
  const lang = resolveLang(globalConfig);
  const clean = String(text || "").trim();
  if (!clean) return { voice: false, reason: "empty" };

  let audio = null;
  let converted = null;
  try {
    const spoken = await synthesizeFn({ text: clean, globalConfig });
    // "mock" is the selector's way of saying nothing spoke — the audio is
    // silence. Sending it would look like a delivered reply the owner simply
    // could not hear, which is worse than plain text.
    if (!spoken?.audio_path || spoken.provider === "mock") {
      return { voice: false, reason: `tts:${spoken?.provider || "none"}` };
    }
    audio = spoken.audio_path;
    converted = await toVoiceNoteFn(audio);
    if (!converted) return { voice: false, reason: "ffmpeg" };

    const duration = Math.round(spoken.duration_s || 0) || undefined;
    await io.sendVoice({ chat_id, audio: converted, duration });
    const transcript = `${t("mobility.transcript", { lang })}:\n${clean}`;
    const sent = await io.send({ chat_id, text: transcript, reply_markup });
    // The tmp file is about to be deleted, so the ledger row cannot point at
    // it — archive the bytes first and hand the caller the meta that makes the
    // web thread show a real player instead of "[voice]".
    const media = outboundMediaMeta(
      "audio",
      archiveOutboundMedia(converted, { mime: "audio/ogg" }),
      { duration }
    );
    return { voice: true, transcript, provider: spoken.provider, media, sent };
  } catch (error) {
    log(`telegram voice reply failed: ${error?.message || error}`);
    return { voice: false, reason: error?.message || "send-failed" };
  } finally {
    // Both files live under ~/.apx/tmp/tts and neither is referenced again:
    // the ledger keeps its own archived copy (media-archive.js) once sendVoice
    // has logged the row.
    for (const file of new Set([audio, converted].filter(Boolean))) {
      try { fs.unlinkSync(file); } catch { /* already gone */ }
    }
  }
}
