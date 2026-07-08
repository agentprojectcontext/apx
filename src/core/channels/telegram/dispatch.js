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
import { callEngine } from "#core/engines/index.js";
import { isSuperAgentEnabled } from "#core/agent/super-agent.js";
import { getRecentTelegramTurnsFromFs, appendGlobalMessage } from "#core/stores/messages.js";
import { compactChannelIfNeeded } from "#core/memory/index.js";
import { readAgents } from "#core/apc/parser.js";
import { buildAgentSystem } from "#core/agent/build-agent-system.js";
import { resolveAgentName, SUPERAGENT_ACTOR_ID } from "#core/identity/index.js";
import { registerSender, resolveAllowedTools } from "#core/identity/telegram.js";
import { buildRelationshipBlock } from "#core/agent/index.js";
import { CHANNELS } from "#core/constants/channels.js";
import { tryResolveSkillCommand } from "#core/agent/skills/trigger.js";
import * as askFlow from "./ask.js";
import { telegramAuthorLabel } from "./helpers.js";
import { handleIncomingPhoto } from "./inbound/photo.js";
import { handleIncomingAudio } from "./inbound/audio.js";
import { buildStreamHandler, runTelegramSuperAgent, telegramErrorText, sendFinalReply, runFollowupTurn } from "./reply.js";
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
    const author = telegramAuthorLabel(msg.from);
    const chat_id = msg.chat?.id;

    // Resolve WHO is writing (owner / known contact / guest), keyed by the
    // stable Telegram user_id. Records unknown senders and, on a fresh private
    // channel with no owner yet, claims this sender as the owner. Mutates the
    // in-memory globalConfig in place so later messages in this daemon session
    // see the update. The resulting block is injected into whichever agent
    // answers (super-agent OR a routed project agent).
    const { sender, claimedOwner } = registerSender({
      cfg: self.globalConfig,
      channelName: self.channel.name,
      from: msg.from,
      chatType: msg.chat?.type,
    });
    if (claimedOwner) {
      // Trust-on-first-use: this sender just became owner of a previously
      // ownerless private channel. Log it so an unexpected claim is visible.
      self.log(`telegram[${self.channel.name}] owner claimed by user_id=${msg.from?.id} (${author}) — verify this is you`);
    }
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

    // ── Incoming media ────────────────────────────────────────────────────
    // Photo and voice/audio each download + archive the file and rewrite `text`
    // so the rest of the pipeline treats them like a typed message. The handlers
    // live in ./inbound/ to keep this dispatcher focused on routing. Photos have
    // no vision yet, so the handler injects an `[image]` marker (never silent);
    // audio injects its `[audio]` transcript.
    if (msg.photo && msg.photo.length > 0) {
      ({ text } = await handleIncomingPhoto(self, { msg, u, author, chat_id, text }));
    }
    const incomingAudio = msg.voice || msg.audio;
    if (incomingAudio && incomingAudio.file_id) {
      ({ text } = await handleIncomingAudio(self, { msg, u, author, chat_id, text, incomingAudio }));
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

    // Preset to the super-agent defaults so every exit path (including one where
    // neither the routed-agent nor the super-agent branch runs) has a valid
    // actor — the routed-agent / super-agent branches override these on success,
    // and their catch blocks reset all four together (no partial-overwrite gap).
    let replyText;
    let replyAuthor;
    let replyActorId = SUPERAGENT_ACTOR_ID;   // stable id: super_agent | agent slug
    let replyKind = "superagent";             // actor_kind: superagent | agent
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
          replyText = t("telegram.error_agent", {
            lang: resolveLang(self.globalConfig),
            vars: { error: e.message.slice(0, 200) },
          });
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

    // Fallback: super-agent — STREAMED. Each iteration's assistant text is sent
    // to Telegram as its own message the moment the model produces it; tool
    // calls are logged but never sent (internal). The streamed turn + its final
    // send live in ./reply.js so this dispatcher and the ask-flow resume
    // (_runResumedTurn in the host poller) share ONE reply path — no drift.
    let saUsage = null;
    let streamedCount = 0;
    let lastStreamedText = "";
    if (!replyText && isSuperAgentEnabled(self.globalConfig)) {
      const { onEvent, state } = buildStreamHandler(self, { chat_id, update_id: u.update_id, agentDisplay });

      // `/slug ...` shortcut: load the matching skill body into contextNote and
      // strip the prefix from the user prompt before sending to the loop.
      const slashed = tryResolveSkillCommand(text, { projectPath: target?.path });

      // A2A callback sink: when a background call_runtime finishes out of band,
      // it invokes this to feed the sub-agent/runtime result back into a fresh
      // super-agent turn — so Roby relays it in its own voice instead of dumping
      // raw output. Self-referential so a relay turn that delegates again keeps
      // the loop. Only wired when we have a chat to stream back to.
      let backgroundResultSink = null;
      if (chat_id) {
        backgroundResultSink = async (reportText) =>
          runFollowupTurn(self, {
            chat_id,
            reportText,
            target,
            author,
            authorId: msg.from?.id,
            relationshipBlock,
            allowedTools,
            agentDisplay,
            update_id: u.update_id,
            backgroundResultSink,
          });
      }

      try {
        const sa = await runTelegramSuperAgent(self, {
          chat_id,
          prompt: slashed.handled ? slashed.prompt : text,
          previousMessages,
          target,
          author,
          authorId: msg.from?.id,
          relationshipBlock,
          allowedTools,
          contextNote: slashed.handled ? slashed.contextNote : "",
          signal: abortCtrl.signal,
          onEvent,
          backgroundResultSink,
        });
        replyText = sa.text;
        replyAuthor = sa.name || agentDisplay;
        replyActorId = SUPERAGENT_ACTOR_ID;
        replyKind = "superagent";
        saUsage = sa.usage;

        // ── ask_questions integration ────────────────────────────────────
        // If the super-agent ended this turn by calling ask_questions, hand off
        // to the inline-keyboard flow instead of sending the bare assistant
        // text. The flow keeps state per chat_id and re-runs the super-agent
        // (via _runResumedTurn) once every answer is collected.
        const askQuestions = askFlow.extractAskQuestionsFromTrace(sa.trace);
        if (askQuestions && chat_id) {
          self.activeRequests.delete(chat_id);
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
        streamedCount = state.streamedCount;
        lastStreamedText = state.lastStreamedText;
      } catch (e) {
        if (abortCtrl.signal.aborted) {
          // A newer message superseded this one. Whatever streamed so far is
          // already sent + logged; the newer message's run continues the thread.
          self.log(`telegram[${self.channel.name}] request aborted for chat ${chat_id}`);
          if (chat_id) self.activeRequests.delete(chat_id);
          stopTyping();
          return;
        }
        self.log(`telegram[${self.channel.name}] super-agent failed: ${e.message}`);
        // Surface the failure to the user instead of silently dropping the turn.
        replyText = telegramErrorText(self, e);
        replyAuthor = agentDisplay;
        replyActorId = SUPERAGENT_ACTOR_ID;
        replyKind = "superagent";
      }
    }

    if (chat_id) self.activeRequests.delete(chat_id);
    stopTyping();
    await sendFinalReply(self, {
      chat_id,
      update_id: u.update_id,
      replyText,
      replyAuthor,
      replyActorId,
      replyKind,
      saUsage,
      streamedCount,
      lastStreamedText,
      agentDisplay,
    });
  }

