// Inbound Telegram update dispatcher.
//
// Extracted from the ChannelPoller class so index.js stays under ~800 lines
// and the routing logic for text/photo/voice/document updates lives on its
// own. Takes the poller instance as `self`; every `this.X` in the original
// method becomes `self.X` here. The poller exposes _handleUpdate as a thin
// facade that delegates to handleUpdate(this, u).
//
// IMPORTANT: this module needs the same imports the original index.js had
// in module scope, because the extracted body references identifiers like
// `appendGlobalMessage`, `CHANNELS`, `nowIso`, etc. Top-level imports here
// keep that scope intact — earlier splits forgot them and the bug only
// surfaced when a real telegram update arrived (ReferenceError at runtime).
import path from "node:path";
import { callEngine } from "#core/engines/index.js";
import { runSuperAgent, isSuperAgentEnabled } from "#core/agent/super-agent.js";
import { stripThinking } from "#core/util/thinking.js";
import { getRecentTelegramTurnsFromFs, appendGlobalMessage } from "#core/stores/messages.js";
import { compactChannelIfNeeded } from "#core/memory/index.js";
import { readAgents } from "#core/apc/parser.js";
import { buildAgentSystem } from "#core/agent/build-agent-system.js";
import { transcribe as transcribeAudioFile } from "../../transcription.js";
import { resolveAgentName, SUPERAGENT_ACTOR_ID } from "#core/identity/index.js";
import { registerSender, resolveAllowedTools } from "#core/identity/telegram.js";
import { buildRelationshipBlock } from "#core/agent/index.js";
import { getConfirmationStore as getConfirmStore } from "#core/confirmation/pending-store.js";
import { CHANNELS } from "#core/constants/channels.js";
import { tryResolveSkillCommand } from "#core/agent/skills/trigger.js";
import { createTelegramConfirmAdapter } from "#core/confirmation/adapters/telegram.js";
import * as askFlow from "./ask.js";
import { buildTelegramMeta, resolveBotToken, sleep } from "./helpers.js";
import { sendPhoto, sendVoice, sendDocument, sendAudio, downloadTelegramFile, API_BASE } from "./media.js";
import { t, resolveLang } from "#core/i18n/index.js";

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export async function handleUpdate(self, u) {
    self.lastUpdateAt = nowIso();

    // Inline keyboard button press: route to the confirmation adapter.
    if (u.callback_query) {
      await self._handleCallbackQuery(u.callback_query);
      return;
    }

    const msg = u.message || u.edited_message;
    if (!msg) return;
    const target = self.resolveProject();
    if (!target) {
      self.log(`telegram[${self.channel.name}] update ${u.update_id} ignored — no target project`);
      return;
    }
    const author =
      msg.from?.username
        ? "@" + msg.from.username
        : `${msg.from?.first_name || ""} ${msg.from?.last_name || ""}`.trim() || "unknown";
    const chat_id = msg.chat?.id;

    // Resolve WHO is writing (owner / known contact / guest), keyed by the
    // stable Telegram user_id. Records unknown senders and, on a fresh private
    // channel with no owner yet, claims this sender as the owner. Mutates the
    // in-memory globalConfig in place so later messages in this daemon session
    // see the update. The resulting block is injected into whichever agent
    // answers (super-agent OR a routed project agent).
    const { sender } = registerSender({
      cfg: self.globalConfig,
      channelName: self.channel.name,
      from: msg.from,
      chatType: msg.chat?.type,
    });
    const relationshipBlock = buildRelationshipBlock(sender);
    // Role-based tool gating for the super-agent path (guests → no tools).
    const allowedTools = resolveAllowedTools(self.globalConfig, sender);

    // Default Interrupt: abort any running request for this chat_id
    if (chat_id) {
      const prev = self.activeRequests.get(chat_id);
      if (prev) {
        self.log(`telegram[${self.channel.name}] interrupting previous request for chat ${chat_id}`);
        prev.abort();
      }
    }
    const abortCtrl = new AbortController();
    if (chat_id) self.activeRequests.set(chat_id, abortCtrl);

    let text = msg.text || msg.caption || "";

    // ── Incoming photo handling ───────────────────────────────────────────
    if (msg.photo && msg.photo.length > 0) {
      // Telegram sends multiple sizes; pick the largest
      const bestPhoto = msg.photo.reduce((a, b) => (b.file_size > a.file_size ? b : a));
      const token = resolveBotToken(self.channel);
      const mediaDir = path.join(APX_HOME, "media");
      fs.mkdirSync(mediaDir, { recursive: true });
      try {
        const localPath = await downloadTelegramFile(token, bestPhoto.file_id, mediaDir);
        self.log(`telegram[${self.channel.name}] photo saved: ${localPath}`);
        appendGlobalMessage({
          channel: CHANNELS.TELEGRAM,
          direction: "in",
          type: "photo",
          actor_id: msg.from?.id ? String(msg.from.id) : author,
          external_id: String(u.update_id),
          author,
          body: text || "[photo]",
          meta: {
            chat_id,
            user_id: msg.from?.id || null,
            message_id: msg.message_id,
            tg_channel: self.channel.name,
            local_path: localPath,
            file_id: bestPhoto.file_id,
            width: bestPhoto.width,
            height: bestPhoto.height,
          },
        });
      } catch (e) {
        self.log(`telegram[${self.channel.name}] photo download failed: ${e.message}`);
      }
      // If there's a caption, continue to handle it as text; otherwise return
      if (!text) return;
    }

    // ── Incoming voice / audio handling ──────────────────────────────────
    // Telegram sends `voice` for the press-and-hold mic recording (.oga/opus)
    // and `audio` for uploaded audio files (mp3/m4a/etc.). Either way we
    // download, run it through Whisper, prefix the result with `[audio] `
    // and let the rest of the message flow handle it as plain text.
    const incomingAudio = msg.voice || msg.audio;
    if (incomingAudio && incomingAudio.file_id) {
      const token = resolveBotToken(self.channel);
      const mediaDir = path.join(APX_HOME, "media");
      fs.mkdirSync(mediaDir, { recursive: true });
      // Show "typing…" right away — download + transcription is the slow part of
      // a voice message, and the reply-path typing (below) only starts after it,
      // so without this the chat sits silent for seconds with no feedback.
      const stopVoiceTyping = self._startTyping(chat_id);
      let localPath = null;
      let transcript = "";
      let transcribeError = null;
      let transcribeBackend = null;
      try {
        localPath = await downloadTelegramFile(token, incomingAudio.file_id, mediaDir);
        self.log(`telegram[${self.channel.name}] audio saved: ${localPath}`);
      } catch (e) {
        self.log(`telegram[${self.channel.name}] audio download failed: ${e.message}`);
      }
      if (localPath) {
        try {
          const result = await transcribeAudioFile(localPath);
          transcript = result.text || "";
          transcribeBackend = result.backend;
          self.log(`telegram[${self.channel.name}] audio transcribed via ${transcribeBackend} (${transcript.length} chars, lang=${result.language || "?"})`);
        } catch (e) {
          transcribeError = e.message;
          self.log(`telegram[${self.channel.name}] audio transcription failed: ${e.message}`);
        }
      }
      stopVoiceTyping(); // reply-path typing takes over from here
      const audioBody = transcript
        ? `[audio] ${transcript}`
        : `[audio] (transcription unavailable${transcribeError ? ": " + transcribeError : ""})`;

      appendGlobalMessage({
        channel: CHANNELS.TELEGRAM,
        direction: "in",
        type: "audio",
        actor_id: msg.from?.id ? String(msg.from.id) : author,
        external_id: String(u.update_id),
        author,
        body: audioBody,
        meta: {
          chat_id,
          user_id: msg.from?.id || null,
          message_id: msg.message_id,
          tg_channel: self.channel.name,
          local_path: localPath,
          file_id: incomingAudio.file_id,
          duration: incomingAudio.duration,
          mime_type: incomingAudio.mime_type,
          transcription_backend: transcribeBackend,
          transcription_error: transcribeError,
        },
      });

      // Inject the transcribed text into `text` so the rest of the agent
      // pipeline treats it identically to a typed message. If there was a
      // caption alongside the audio, prepend the audio marker to it.
      text = text ? `${audioBody}\n${text}` : audioBody;
    }

    // If there's a pending ask_questions flow for this chat AND the current
    // question is free-text, treat this message as the answer rather than a
    // brand-new turn. Returns true when the message was consumed.
    if (chat_id && text && await self._maybeConsumeAskTextAnswer({ chat_id, text })) {
      // Still log the inbound so the chat history records what the user said.
      appendGlobalMessage({
        channel: CHANNELS.TELEGRAM,
        direction: "in",
        type: "user",
        actor_id: msg.from?.id ? String(msg.from.id) : author,
        external_id: String(u.update_id),
        author,
        body: text,
        meta: {
          chat_id,
          user_id: msg.from?.id || null,
          message_id: msg.message_id,
          tg_channel: self.channel.name,
          ask_answer: true,
        },
      });
      return;
    }

    // /reset or /new wipes the rolling context for this chat. We just
    // remember a marker timestamp; subsequent inbounds will only consider
    // history newer than self. Implemented by writing a synthetic message
    // with a known marker so getRecentTelegramTurns naturally cuts off.
    const isReset = /^\/(reset|new)\b/i.test(text.trim());

    // Pull the prior conversation BEFORE we log this inbound — so the
    // current message isn't part of its own history. We then prune anything
    // older than the most recent /reset for this chat_id.
    let previousMessages = [];
    if (chat_id && !isReset) {
      previousMessages = getRecentTelegramTurnsFromFs({
        chat_id,
        keepRecent: 40,
        max_age_hours: 24,
      });
      // Progressive compaction (Pieza 3) runs OUT of the reply path: if this
      // chat is over threshold, summarize the oldest turns in the background so
      // the next turn reads a [RESUMEN COMPACTADO] instead of raw history. Never
      // awaited — adds zero latency to this reply, degrades gracefully.
      compactChannelIfNeeded({
        channel: CHANNELS.TELEGRAM,
        chat_id,
        config: self.globalConfig,
        log: self.log,
      }).catch(() => {});
      // Honour a /reset marker: drop everything up to and including it.
      const lastResetIdx = (() => {
        for (let i = previousMessages.length - 1; i >= 0; i--) {
          if (
            previousMessages[i].role === "user" &&
            /^\/(reset|new)\b/i.test(previousMessages[i].content.trim())
          ) {
            return i;
          }
        }
        return -1;
      })();
      if (lastResetIdx >= 0) {
        previousMessages = previousMessages.slice(lastResetIdx + 1);
      }
    }

    // Always log inbound to global store (~/.apx/messages/telegram/)
    appendGlobalMessage({
      channel: CHANNELS.TELEGRAM,
      direction: "in",
      type: "user",
      actor_id: msg.from?.id ? String(msg.from.id) : author,
      external_id: String(u.update_id),
      author,
      body: text,
      meta: {
        chat_id,
        user_id: msg.from?.id || null,
        message_id: msg.message_id,
        tg_channel: self.channel.name,
      },
    });

    // Super-agent is ALWAYS active on Telegram: respond_with_engine === false
    // used to silently drop user messages, which looked to the user like the
    // bot ignored them. Honour the legacy flag only as a soft hint (skip the
    // routed-agent shortcut so we fall straight to super-agent) but never let
    // it short-circuit the whole reply. To genuinely silence the bot, disable
    // the channel entirely (telegram.enabled = false in config).
    const skipRoutedAgent = self.channel.respond_with_engine === false;
    if (!text) return;

    // Short-circuit /reset / /new: send an ack and don't engage the engine.
    // The marker we just logged is enough — getRecentTelegramTurns will
    // honor it for future messages.
    if (isReset) {
      try {
        const ack = t("telegram.reset_ack", { lang: resolveLang(self.globalConfig) });
        await self._send({ chat_id, text: ack });
        appendGlobalMessage({
          channel: CHANNELS.TELEGRAM,
          direction: "out",
          type: "agent",
          actor_id: SUPERAGENT_ACTOR_ID,
          actor_kind: "superagent",
          agent_slug: SUPERAGENT_ACTOR_ID,
          author: resolveAgentName(self.globalConfig),
          body: ack,
          meta: { chat_id, tg_channel: self.channel.name, in_reply_to: u.update_id, reset: true },
        });
      } catch (e) {
        self.log(`telegram[${self.channel.name}] reset ack failed: ${e.message}`);
      }
      return;
    }

    // Start "typing..." indicator. Stops when we send the reply (or fail).
    const stopTyping = self._startTyping(chat_id);

    let replyText;
    let replyAuthor;
    let replyActorId;   // stable id: super_agent | agent slug
    let replyKind;      // actor_kind: superagent | agent
    const projectCfg = target.config || self.globalConfig;
    // Display name for the super-agent persona on this channel (from identity.json).
    const agentDisplay = resolveAgentName(self.globalConfig);

    // Try the project's chosen agent first (skipped if the legacy
    // respond_with_engine === false hint asked to bypass routed agents).
    const routeSlug = skipRoutedAgent ? null : self.channel.route_to_agent;
    if (routeSlug) {
      const agent = readAgents(target.path).find((a) => a.slug === routeSlug);
      if (agent && agent.fields.Model) {
        try {
          const system = buildAgentSystem(target, agent, {
            invocation: "telegram",
            channel: self.channel.name,
            caller: author,
            extraParts: [relationshipBlock],
          });
          const result = await callEngine({
            modelId: agent.fields.Model,
            system,
            messages: [{ role: "user", content: text }],
            config: projectCfg,
          });
          replyText = result.text;
          replyAuthor = agent.slug;
          replyActorId = agent.slug;
          replyKind = "agent";
        } catch (e) {
          self.log(`telegram[${self.channel.name}] agent reply failed: ${e.message}`);
          replyText = `[apx error] ${e.message.slice(0, 200)}`;
          replyAuthor = agentDisplay;
          replyActorId = SUPERAGENT_ACTOR_ID;
          replyKind = "superagent";
        }
      } else {
        self.log(
          `telegram[${self.channel.name}] route_to_agent="${routeSlug}" not usable (missing or no model) → trying super-agent`
        );
      }
    }

    // Fallback: super-agent — STREAMED.
    // Each iteration's assistant text is sent to Telegram as its own message
    // the moment the model produces it (its running commentary), so the user
    // sees a real back-and-forth instead of one giant final dump. Tool calls
    // are logged to the message store — visible via apx log / apx search and
    // to channels that render tools — but NEVER sent to Telegram; tools are
    // internal. The conversation saved on disk is the full, real exchange;
    // Telegram is just the prose-only view of it.
    let saUsage = null;
    let streamedCount = 0;
    let lastStreamedText = "";
    // Telegram shows the user ONLY prose — never the tool calls. On an action
    // request the model often jumps straight to a tool with no preamble text,
    // so the user would stare at a silent chat until the final reply. Send one
    // short localized heads-up the moment real work starts (first tool_start),
    // but only if the agent didn't already write its own "on it" line.
    let sentHeadsUp = false;
    const headsUpPhrase = () => t("telegram.heads_up", { lang: resolveLang(self.globalConfig) });
    if (!replyText && isSuperAgentEnabled(self.globalConfig)) {
      const onEvent = async (ev) => {
        try {
          if (ev.type === "tool_start" && !sentHeadsUp && streamedCount === 0) {
            sentHeadsUp = true;
            const heads = headsUpPhrase();
            await self._send({ chat_id, text: heads });
            appendGlobalMessage({
              channel: CHANNELS.TELEGRAM,
              direction: "out",
              type: "agent",
              actor_id: SUPERAGENT_ACTOR_ID,
              actor_kind: "superagent",
              agent_slug: SUPERAGENT_ACTOR_ID,
              author: agentDisplay,
              body: heads,
              meta: { chat_id, tg_channel: self.channel.name, in_reply_to: u.update_id, heads_up: true },
            });
            return;
          }
          if (ev.type === "assistant_text" && ev.text) {
            const piece = stripThinking(ev.text).trim();
            if (!piece) return;
            await self._send({ chat_id, text: piece });
            lastStreamedText = piece;
            streamedCount += 1;
            appendGlobalMessage({
              channel: CHANNELS.TELEGRAM,
              direction: "out",
              type: "agent",
              actor_id: SUPERAGENT_ACTOR_ID,
              actor_kind: "superagent",
              agent_slug: SUPERAGENT_ACTOR_ID,
              author: agentDisplay,
              body: piece,
              meta: {
                chat_id,
                tg_channel: self.channel.name,
                in_reply_to: u.update_id,
                streamed: true,
                iteration: ev.iteration,
              },
            });
          } else if (ev.type === "tool_result" && ev.trace) {
            // Logged for the audit trail / other channels — NOT sent to Telegram.
            const t = ev.trace;
            appendGlobalMessage({
              channel: CHANNELS.TELEGRAM,
              direction: "out",
              type: "tool",
              actor_id: t.tool,
              actor_kind: "tool",
              author: agentDisplay,
              body: `${t.tool}(${JSON.stringify(t.args || {}).slice(0, 200)})`,
              meta: {
                chat_id,
                tg_channel: self.channel.name,
                in_reply_to: u.update_id,
                tool: t.tool,
                args: t.args,
                result: t.result,
                iteration: ev.iteration,
              },
            });
          }
        } catch (e) {
          // A failed intermediate send must not abort the whole run.
          self.log(`telegram[${self.channel.name}] stream event failed: ${e.message}`);
        }
      };

      const confirmAdapter = createTelegramConfirmAdapter({
        token: resolveBotToken(self.channel),
        chatId: chat_id,
        pendingStore: getConfirmStore(),
      });

      // `/slug ...` shortcut: load the matching skill body into contextNote
      // and strip the prefix from the user prompt before sending to the loop.
      const slashed = tryResolveSkillCommand(text, { projectPath: target?.path });
      const slashedPrompt = slashed.handled ? slashed.prompt : text;
      const slashedContextNote = slashed.handled ? slashed.contextNote : "";

      try {
        const sa = await runSuperAgent({
          globalConfig: self.globalConfig,
          projects: self.projects,
          plugins: self.plugins,
          registries: self.registries,
          prompt: slashedPrompt,
          previousMessages,
          channel: CHANNELS.TELEGRAM,
          relationshipBlock,
          allowedTools,
          contextNote: slashedContextNote || undefined,
          channelMeta: buildTelegramMeta({
            channelName: self.channel.name,
            author,
            chatId: chat_id,
            target,
            routeToAgent: self.channel.route_to_agent,
          }),
          signal: abortCtrl.signal,
          onEvent,
          requestConfirmation: confirmAdapter.requestConfirmation,
        });
        replyText = sa.text;
        replyAuthor = sa.name || agentDisplay;
        replyActorId = SUPERAGENT_ACTOR_ID;
        replyKind = "superagent";
        saUsage = sa.usage;

        // ── ask_questions integration ────────────────────────────────────
        // If the super-agent ended this turn by calling ask_questions, hand
        // off to the inline-keyboard flow instead of sending the bare
        // assistant text. The flow keeps state per chat_id and re-runs the
        // super-agent once every answer is collected.
        const askQuestions = askFlow.extractAskQuestionsFromTrace(sa.trace);
        if (askQuestions && chat_id) {
          if (chat_id) self.activeRequests.delete(chat_id);
          stopTyping();
          try {
            await self._startAskFlow({
              chat_id,
              projectId: target?.id,
              authorId: msg.from?.id,
              questions: askQuestions,
              author,
              agentDisplay,
              relationshipBlock,
              allowedTools,
              target,
              sender,
              update_id: u.update_id,
            });
          } catch (e) {
            self.log(`telegram[${self.channel.name}] ask flow start failed: ${e.message}`);
          }
          return; // The reply for this turn IS the ask flow.
        }
      } catch (e) {
        if (abortCtrl.signal.aborted) {
          // A newer message superseded this one. Whatever streamed so far is
          // already sent + logged; the newer message's run continues the
          // thread from that history.
          self.log(`telegram[${self.channel.name}] request aborted for chat ${chat_id}`);
          if (chat_id) self.activeRequests.delete(chat_id);
          stopTyping();
          return;
        }
        self.log(`telegram[${self.channel.name}] super-agent failed: ${e.message}`);
        // Surface the failure to the user instead of silently dropping the
        // turn — otherwise from the chat side it looks like the bot ignored
        // the message. Keep the message short and non-leaking.
        replyText = `⚠️ Could not generate a reply right now (${e.message || "internal error"}).`;
        replyAuthor = agentDisplay;
        replyActorId = SUPERAGENT_ACTOR_ID;
        replyKind = "superagent";
      }
    }

    if (chat_id) self.activeRequests.delete(chat_id);

    // Final answer. The intermediate prose was already streamed; only send the
    // final text if it's non-empty AND not a duplicate of the last streamed
    // piece (the loop can end on an iteration whose text was already sent).
    // If nothing streamed and there's no final text, send a minimal ack so the
    // turn isn't silently empty.
    const finalClean = replyText ? stripThinking(replyText).trim() : "";
    let toSend = "";
    if (finalClean && finalClean !== lastStreamedText) toSend = finalClean;
    else if (!finalClean && streamedCount === 0) {
      toSend = t("telegram.fallback_listo", { lang: resolveLang(self.globalConfig) });
    }

    stopTyping();
    if (!toSend) return; // everything was already streamed — nothing left to send

    try {
      await self._send({ chat_id, text: toSend });
      const meta = {
        chat_id,
        tg_channel: self.channel.name,
        in_reply_to: u.update_id,
        final: true,
      };
      if (replyText && stripThinking(replyText) !== replyText) meta.thinking_stripped = true;
      if (saUsage) meta.usage = saUsage;
      appendGlobalMessage({
        channel: CHANNELS.TELEGRAM,
        direction: "out",
        type: "agent",
        actor_id: replyActorId || SUPERAGENT_ACTOR_ID,
        actor_kind: replyKind || "superagent",
        agent_slug: replyActorId || SUPERAGENT_ACTOR_ID,
        author: replyAuthor || agentDisplay,
        body: toSend,
        meta,
      });
    } catch (e) {
      self.log(`telegram[${self.channel.name}] send-back error: ${e.message}`);
      appendGlobalMessage({
        channel: CHANNELS.TELEGRAM,
        direction: "out",
        type: "agent",
        actor_id: replyActorId || SUPERAGENT_ACTOR_ID,
        actor_kind: replyKind || "superagent",
        agent_slug: replyActorId || SUPERAGENT_ACTOR_ID,
        author: replyAuthor || agentDisplay,
        body: `[send_failed] ${toSend}`,
        meta: {
          chat_id,
          tg_channel: self.channel.name,
          in_reply_to: u.update_id,
          send_error: e.message,
          ...(saUsage ? { usage: saUsage } : {}),
        },
      });
    }
  }

