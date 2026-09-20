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
import { compactChannelIfNeeded, agentScopedMemoryBlock } from "#core/memory/index.js";
import { readAgents } from "#core/apc/parser.js";
import { buildAgentSystem } from "#core/agent/build-agent-system.js";
import { resolveAgentModel } from "#core/agent/agent-model.js";
import { resolveAgentName, SUPERAGENT_ACTOR_ID } from "#core/identity/index.js";
import { registerSender, resolveAllowedTools } from "#core/identity/telegram.js";
import { buildRelationshipBlock } from "#core/agent/index.js";
import { authorLine } from "#core/agent/author-line.js";
import { CHANNELS } from "#core/constants/channels.js";
import { tryResolveSkillCommand } from "#core/agent/skills/trigger.js";
import * as askFlow from "./ask.js";
import { telegramAuthorLabel, releaseActiveRequest, isImpatientResend } from "./helpers.js";
import { handleIncomingPhoto } from "./inbound/photo.js";
import { handleIncomingAudio } from "./inbound/audio.js";
import { handleIncomingFile, detectIncomingFile } from "./inbound/file.js";
import { buildStreamHandler, runTelegramSuperAgent, telegramErrorText, sendFinalReply, runFollowupTurn } from "./reply.js";
import { t, resolveLang } from "#core/i18n/index.js";
import { isMobilitySilenceCommand, silenceMobilityToday } from "#core/mobility/preferences.js";

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// One Telegram message = ONE stored record. The media handlers used to append
// their own row AND rewrite `text`, so dispatch's inbound log stored the same
// turn a second time: the viewer showed it twice, the current transcript landed
// in its own history (the media row was already on disk by the time we read it
// back), and the next turn replayed it twice more. They now return what they
// archived and this folds it into the single inbound record, so the file
// metadata (local_path, file_id, …) is not lost with the duplicate.
function mediaMeta(media) {
  if (!media.length) return {};
  return {
    ...Object.assign({}, ...media.map((m) => m.meta)),
    media_kind: media.length === 1 ? media[0].kind : media.map((m) => m.kind),
  };
}

/**
 * What the running turn has DONE so far, kept on its own abort controller.
 *
 * The next inbound message finds it there: interrupting is only half of "pará y
 * seguí con esto otro" — the turn that replaces this one has to know which
 * tools already ran, or it repeats them. Conversation history cannot carry that
 * (it filters tool rows out on purpose), so the controller does.
 */
function rememberEffect(abortCtrl, ev) {
  if (ev?.type !== "tool_result" || !ev.trace?.tool) return;
  if (!Array.isArray(abortCtrl.effects)) abortCtrl.effects = [];
  abortCtrl.effects.push({ tool: ev.trace.tool, args: ev.trace.args, result: ev.trace.result });
}

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

    // What the user actually typed, needed before the interrupt decision below.
    // Media handlers rewrite it further down; a resend is plain text, so the raw
    // field is enough here.
    let text = msg.text || msg.caption || "";
    /** Set when THIS message stopped a turn that was already working. */
    let interrupted = null;
    if (isMobilitySilenceCommand(text)) silenceMobilityToday();

    // Default Interrupt: a new message aborts the running turn for this chat —
    // "no, stop, do this instead". Except when the "new" message is the SAME
    // one the turn is already working on: that is the user checking whether a
    // quiet turn is still alive, and aborting it restarts the work from zero
    // (see isImpatientResend). Then we let the running turn finish and say so.
    if (chat_id) {
      const prev = self.activeRequests.get(chat_id);
      if (prev && isImpatientResend(prev, text)) {
        const secs = Math.round((Date.now() - prev.startedAt) / 1000);
        self.log(
          `telegram[${self.channel.name}] resend of the in-flight message for chat ${chat_id} ` +
          `(${secs}s in) — keeping the running turn`
        );
        // Logged so the history is honest about what was sent, flagged so the
        // turn that eventually answers knows it was asked twice.
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
            resend_of_in_flight: true,
          },
        });
        try {
          // Its own words, from the situation — not a canned "please wait".
          const line = await authorLine({
            globalConfig: self.globalConfig,
            instruction:
              `You are ${Math.round(secs / 60) || 1} minute(s) into working on exactly this request ` +
              `and the user just sent it again, which means the quiet made them think you stopped. ` +
              `In ONE short line: you are still on it, and say what you are doing right now. ` +
              `Do not restart, do not apologise at length, do not promise a time.`,
          });
          if (line) await self._send({ chat_id, text: line });
        } catch (e) {
          self.log(`telegram[${self.channel.name}] resend ack failed: ${e.message}`);
        }
        return;
      }
      if (prev) {
        self.log(`telegram[${self.channel.name}] interrupting previous request for chat ${chat_id}`);
        // WHAT THE INTERRUPTED TURN HAD ALREADY DONE.
        //
        // Aborting is the easy half and has worked for a while: a new message
        // stops the running turn. The half that was missing is continuity —
        // "que continúes con la nueva info que mande" (Manu, 2026-09-20). The
        // replacement turn used to start blind: the conversation history filters
        // tool rows out on purpose (they once ate 84% of a thread's context), so
        // the work the aborted turn had already done was invisible to it. It
        // would cheerfully send the same WhatsApp again, or file the same task
        // twice.
        //
        // So the effects travel. `priorEffects` seeds the side-effect ledger,
        // which answers a repeat with "already done" instead of doing it again
        // — the same mechanism a resumed turn uses after a restart.
        interrupted = {
          text: prev.text || "",
          effects: Array.isArray(prev.effects) ? prev.effects.slice(-20) : [],
          seconds: Math.round((Date.now() - (prev.startedAt || Date.now())) / 1000),
        };
        prev.abort();
      }
    }
    const abortCtrl = new AbortController();
    // The turn's own text and start time ride on the controller so the next
    // inbound can tell "do something else" from "are you still there".
    abortCtrl.text = text;
    abortCtrl.startedAt = Date.now();
    // Every tool this turn completes, in order. Empty until it runs one.
    abortCtrl.effects = [];
    if (chat_id) self.activeRequests.set(chat_id, abortCtrl);

    // ── Incoming media ────────────────────────────────────────────────────
    // Photo, voice/audio and files each download the attachment and rewrite
    // `text` so the rest of the pipeline treats them like a typed message; the
    // file metadata comes back in `media` and is stored on the single inbound
    // record below. The handlers live in ./inbound/ to keep this dispatcher
    // focused on routing. Each one
    // injects a marker so a caption-less attachment is never an empty turn:
    // photos an `[image]` marker (plus the pixels, as an attachment, for a
    // multimodal engine), audio its `[audio]` transcript, files a description
    // with the local path.
    const attachments = [];
    const media = [];   // what the handlers downloaded, folded into the inbound record below
    if (msg.photo && msg.photo.length > 0) {
      let attachment, archived;
      ({ text, attachment, media: archived } = await handleIncomingPhoto(self, { msg, text }));
      if (attachment) attachments.push(attachment);
      if (archived) media.push(archived);
    }
    const incomingAudio = msg.voice || msg.audio;
    if (incomingAudio && incomingAudio.file_id) {
      let archived;
      ({ text, media: archived } = await handleIncomingAudio(self, { chat_id, text, incomingAudio }));
      if (archived) media.push(archived);
    }
    // Documents, video, video notes and GIFs. Without this a file sent with no
    // caption left `text` empty, the turn was dropped, and the bot answered
    // nothing at all.
    const incomingFile = detectIncomingFile(msg);
    if (incomingFile) {
      let archived;
      ({ text, media: archived } = await handleIncomingFile(self, { text, incoming: incomingFile }));
      if (archived) media.push(archived);
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
          ...mediaMeta(media),
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
        ...mediaMeta(media),
        chat_id,
        user_id: msg.from?.id || null,
        message_id: msg.message_id,
        tg_channel: self.channel.name,
      },
    });

    // Super-agent is ALWAYS active on Telegram: respond_with_engine === false
    // used to silently drop user messages, which looked to the user like the
    // bot ignored them. Honour the flag only as a soft hint (skip the
    // routed-agent shortcut so we fall straight to super-agent) but never let
    // it short-circuit the whole reply. To genuinely silence the bot, disable
    // the channel entirely (telegram.enabled = false in config).
    const skipRoutedAgent = self.channel.respond_with_engine === false;
    if (!text) return;

    // Short-circuit /reset / /new: confirm and stop. No turn runs — the one
    // model call below writes the confirmation itself, it does not answer the
    // command. The marker we just logged is enough — getRecentTelegramTurns
    // will honor it for future messages.
    if (isReset) {
      try {
        // The ack is ours to trigger, not to word: the model writes it, and the
        // canned line is only what goes out if it can't (engine down, no model
        // configured). See core/agent/author-line.js.
        const lang = resolveLang(self.globalConfig);
        // Writing it takes a second or two, which on a chat reads as nothing
        // happening — the same indicator a normal turn puts up covers it.
        const stopAckTyping = self._startTyping(chat_id);
        let ack;
        try {
          ack = (await authorLine({
            globalConfig: self.globalConfig,
            instruction: "The user just cleared this conversation — from here you remember none of it and the thread starts fresh. Confirm that in one line and invite what comes next.",
          })) || t("telegram.reset_ack", { lang });
        } finally {
          stopAckTyping();
        }
        await self._send({ chat_id, text: ack });
        // attribution-exempt: /reset ack — a short model-authored line whose attribution the ack path does not surface.
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

    // The same turn, registered where every OTHER surface can find it.
    //
    // `_startTyping` above reaches exactly one place: this chat. The web panel,
    // the desktop and the phone read a turn in flight out of the daemon's
    // registry and then follow its frames — and nothing outside the HTTP routes
    // ever wrote to it, so a turn that arrived on Telegram simply did not exist
    // for them. Manu on 2026-09-14: "en telegram dice Escribiendo" while the
    // same conversation on the web sat dead, and a refresh brought in every
    // tool at once — they had been on disk all along.
    //
    // Keyed by (project, channel) and stamped with the day, because that is how
    // a global channel thread is addressed and therefore how the reader looks
    // it up (api/conversations.js, `superAgentTurnKey`). Optional by design:
    // core must not import daemon runtime (rule 8), so this arrives through
    // `self` like `_send`, and a channel running outside a daemon is simply not
    // followed rather than broken.
    const turn = self._trackTurn?.({
      projectId: target?.id ?? null,
      channel: CHANNELS.TELEGRAM,
      threadId: new Date().toISOString().slice(0, 10),
      // What was asked, kept so a restart that has to cut this off can hand it
      // to the next daemon instead of finding half a sentence and no cause.
      prompt: text,
      // What Stop and POST /turns/abort pull. The poller's own supersede path
      // already owns this controller; this just gives the panel the same lever.
      abort: () => abortCtrl.abort(),
    });

    // Detach the model turn from the poll loop. Awaiting it here used to freeze
    // getUpdates for the whole run, so a newer Telegram message could never
    // abort this one — Default Interrupt existed, but never fired.
    const replyTurn = (async () => {
    try {

    // Preset to the super-agent defaults so every exit path (including one where
    // neither the routed-agent nor the super-agent branch runs) has a valid
    // actor — the routed-agent / super-agent branches override these on success,
    // and their catch blocks reset all four together (no partial-overwrite gap).
    let replyText;
    let replyAuthor;
    let replyActorId = SUPERAGENT_ACTOR_ID;   // stable id: super_agent | agent slug
    let replyKind = "superagent";             // actor_kind: superagent | agent
    let replyModel = null;                    // model that actually produced the reply
    let replyUsage = null;                    // token accounting for this turn
    let replyTrace = null;                    // what the turn actually did (summarised on the message)
    let replyJudge = null;                    // verdict trail, when the turn was continued past a stop
    let replyInspector = null;                // the per-turn skill decision, for the ledger row
    const projectCfg = target.config || self.globalConfig;
    // Display name for the super-agent persona on this channel (from identity.json).
    const agentDisplay = resolveAgentName(self.globalConfig);

    // Try the project's chosen agent first (skipped when the
    // respond_with_engine === false hint asked to bypass routed agents).
    const routeSlug = skipRoutedAgent ? null : self.channel.route_to_agent;
    if (routeSlug) {
      const agent = readAgents(target.path).find((a) => a.slug === routeSlug);
      // An agent that inherits its model is still usable: the router resolves
      // one for it, same as a direct chat.
      const agentModel = agent ? await resolveAgentModel({ agent, config: projectCfg }) : null;
      if (agent && agentModel) {
        try {
          const scopedMemory = await agentScopedMemoryBlock(text, { project: target, agent, config: projectCfg });
          const system = buildAgentSystem(target, agent, {
            invocation: "telegram",
            channel: self.channel.name,
            caller: author,
            extraParts: [relationshipBlock, scopedMemory].filter(Boolean),
          });
          const result = await callEngine({
            modelId: agentModel,
            system,
            messages: [{ role: "user", content: text }],
            config: projectCfg,
            signal: abortCtrl.signal,
          });
          replyText = result.text;
          replyAuthor = agent.slug;
          replyActorId = agent.slug;
          replyKind = "agent";
          // Fully-qualified id (provider:model) — callEngine resolves it
          // internally and doesn't hand it back.
          replyModel = agentModel;
          replyUsage = result.usage || null;
        } catch (e) {
          self.log(`telegram[${self.channel.name}] agent reply failed: ${e.message}`);
          replyText = t("telegram.error_agent", {
            lang: resolveLang(self.globalConfig),
            vars: { error: e.message.slice(0, 200) },
          });
          replyAuthor = agentDisplay;
          replyActorId = SUPERAGENT_ACTOR_ID;
          replyKind = "superagent";
          replyModel = null;
          replyUsage = null;
        }
      } else {
        self.log(
          `telegram[${self.channel.name}] route_to_agent="${routeSlug}" not usable (missing or no model) → trying super-agent`
        );
      }
    }

    // Fallback: super-agent — STREAMED, but not narrated step by step. One
    // notice goes out when work starts, the notes before every later step are
    // held (./progress-gate.js), and the closing message carries the result;
    // tool calls are logged but never sent (internal). The streamed turn + its
    // final send live in ./reply.js so this dispatcher and the ask-flow resume
    // (_runResumedTurn in the host poller) share ONE reply path — no drift.
    let streamedCount = 0;
    let lastStreamedText = "";
    let heldCount = 0;
    if (!replyText && isSuperAgentEnabled(self.globalConfig)) {
      const { onEvent: streamToChat, state } = buildStreamHandler(self, { chat_id, update_id: u.update_id, agentDisplay });
      // TWO audiences for one turn, and only the first was ever served. The
      // stream handler decides what TELEGRAM sees (prose only, intermediate
      // notes held — see ./progress-gate.js); the tracker records the same
      // steps for every other surface, which wants the opposite: the tools, as
      // they happen. Same events, two renderings — the channel owns its output,
      // nobody owns the fact that a turn is running.
      const onEvent = async (ev) => {
        turn?.onEvent(ev);
        rememberEffect(abortCtrl, ev);
        return streamToChat(ev);
      };

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
          attachments,
          interrupted,
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
        replyUsage = sa.usage;
        replyTrace = sa.trace || null;
        replyJudge = sa.judge || null;
        replyModel = sa.model || state.model || null;
        // What the per-turn skill RAG decided, so the ledger row carries it and
        // the thread shows the same skill badges a web turn does.
        replyInspector = sa.skillInspector || null;

        // ── ask_questions integration ────────────────────────────────────
        // If the super-agent ended this turn by calling ask_questions, hand off
        // to the inline-keyboard flow instead of sending the bare assistant
        // text. The flow keeps state per chat_id and re-runs the super-agent
        // (via _runResumedTurn) once every answer is collected.
        const askQuestions = askFlow.extractAskQuestionsFromTrace(sa.trace);
        if (askQuestions && chat_id) {
          releaseActiveRequest(self.activeRequests, chat_id, abortCtrl);
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
        heldCount = state.heldCount;
      } catch (e) {
        if (abortCtrl.signal.aborted) {
          // A newer message superseded this one. Whatever streamed so far is
          // already sent + logged; the newer message's run continues the thread.
          self.log(`telegram[${self.channel.name}] request aborted for chat ${chat_id}`);
          // Superseded, not broken. A follower has to be told which, or the
          // bubble it is holding never closes.
          turn?.aborted();
          releaseActiveRequest(self.activeRequests, chat_id, abortCtrl);
          stopTyping();
          return;
        }
        self.log(`telegram[${self.channel.name}] super-agent failed: ${e.message}`);
        // Surface the failure to the user instead of silently dropping the turn.
        replyText = telegramErrorText(self, e);
        replyAuthor = agentDisplay;
        replyActorId = SUPERAGENT_ACTOR_ID;
        replyKind = "superagent";
        replyModel = state.model || null;
      }
    }

    if (abortCtrl.signal.aborted) {
      self.log(`telegram[${self.channel.name}] request aborted for chat ${chat_id}`);
      turn?.aborted();
      releaseActiveRequest(self.activeRequests, chat_id, abortCtrl);
      stopTyping();
      return;
    }
    releaseActiveRequest(self.activeRequests, chat_id, abortCtrl);
    stopTyping();
    await sendFinalReply(self, {
      chat_id,
      update_id: u.update_id,
      replyText,
      replyAuthor,
      replyActorId,
      replyKind,
      saUsage: replyUsage,
      saModel: replyModel,
      saTrace: replyTrace,
      streamedCount,
      lastStreamedText,
      heldCount,
      agentDisplay,
      // Recoverable after the fact: this turn ran longer because a verdict said
      // it wasn't finished, not because the model rambled.
      extraMeta: {
        ...(replyJudge ? { judge: replyJudge } : {}),
        ...(replyInspector ? { skill_inspector: replyInspector } : {}),
      },
    });
    // The ending, so a follower's bubble CLOSES. Without a closing frame it
    // stays pending forever, the silent catch-up refuses to run (it skips while
    // a turn is in flight) and Stop sits on screen over a turn that finished
    // minutes ago — the exact failure api/conversations.js documents for a2a.
    turn?.final({
      text: replyText || "",
      ...(replyUsage ? { usage: replyUsage } : {}),
      ...(replyModel ? { model: replyModel } : {}),
      name: replyAuthor || agentDisplay,
    });
    } finally {
      // Every exit above returns early on abort or on the ask-flow hand-off, so
      // the deregistration belongs here and nowhere else: a turn left in the
      // registry is a spinner that never stops on every panel in the house.
      turn?.end();
    }
    })();
    replyTurn.catch((e) => {
      self.log(`telegram[${self.channel.name}] reply turn crashed: ${e.message}`);
    });
  }
