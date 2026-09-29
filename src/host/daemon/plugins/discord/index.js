// Discord plugin: owns the bot connection's lifecycle inside the daemon.
//
// Thin on purpose, like its WhatsApp and Telegram siblings. What a message
// means, whether it is answered and what the answer is told all live in
// core/channels/discord/; this file only connects, disconnects, and lends the
// owner-report path through the Telegram plugin.
import { createDiscordGateway } from "#core/channels/discord/gateway.js";
import { createDiscordDispatcher } from "#core/channels/discord/dispatch.js";
import { readDiscordConfig, discordToken } from "#core/channels/discord/config.js";
import { postDiscord } from "#core/channels/discord/outbox.js";
import { markOwnerRows } from "#core/channels/discord/owner-rows.js";
import { canNudge, recordNudge } from "#core/nudge/index.js";
import { CHANNELS } from "#core/constants/channels.js";
import { readConfig } from "#core/config/index.js";

export default {
  id: "discord",

  init({ projects, log, plugins, registries }) {
    let gateway = null;
    let dispatcher = null;
    let lastStatus = { state: "off" };

    // Tell the owner what the bot did in their community. Unlike the WhatsApp
    // report, nobody wrote TO the owner here — the bot answered strangers in a
    // public room — so these are interruptions the owner did not ask for, and
    // they pass the same budget and quiet hours as any other push. The
    // dispatcher already coalesces them per room; the gate decides whether
    // even the coalesced one is worth a buzz right now.
    async function notifyOwner(text, meta = {}) {
      const telegram = plugins?.get?.("telegram");
      if (typeof telegram?.send !== "function") {
        log(`discord → owner (telegram unavailable): ${text}`);
        return;
      }
      const gate = canNudge({ kind: meta.kind || "discord", channel: CHANNELS.TELEGRAM }, readConfig());
      if (!gate.allowed) {
        log(`discord → owner held (${gate.reason}): ${text}`);
        return;
      }
      try {
        await telegram.send({ text, meta: { kind: meta.kind || "discord", ...meta } });
        recordNudge(gate, { preview: text });
      } catch (e) {
        log(`discord → owner failed: ${e.message}`);
      }
    }

    return {
      // Reads the config fresh, not the boot snapshot, so the panel can save a
      // token and reconnect without restarting the daemon.
      start() {
        const cfg = readConfig();
        const dc = readDiscordConfig(cfg);
        if (dc.enabled === false) {
          log("discord: disabled in config — not starting");
          lastStatus = { state: "off" };
          return;
        }
        const token = discordToken(cfg);
        if (!token) {
          log("discord: no bot token — idle until discord.token is set");
          lastStatus = { state: "off" };
          return;
        }
        // Before the connection opens, while nothing else writes these files.
        try {
          const n = markOwnerRows(dc.owner_ids);
          if (n) log(`discord: owner mark updated on ${n} stored message${n === 1 ? "" : "s"}`);
        } catch (e) {
          log(`discord: could not update the owner mark: ${e.message}`);
        }
        if (!Object.keys(dc.channels).length) {
          log("discord: no channels listed yet — connecting, but the bot will read and say nothing until you add one (apx discord channel set <id> <mode>)");
        }
        gateway = createDiscordGateway({
          token,
          log,
          onStatus: (s) => { lastStatus = s; },
          onMessage: (m) => dispatcher.handle(m),
        });
        dispatcher = createDiscordDispatcher({
          transport: gateway,
          projects,
          plugins,
          registries,
          log,
          notifyOwner,
        });
        gateway.start();
      },

      stop() {
        try { dispatcher?.stop(); } catch { /* nothing pending */ }
        try { gateway?.stop(); } catch { /* already down */ }
        dispatcher = null;
        gateway = null;
      },

      /** Drop the connection and open a new one with whatever the config says now. */
      reconnect() {
        this.stop();
        this.start();
        return this.status();
      },

      status() {
        const dc = readDiscordConfig();
        return {
          running: !!gateway,
          enabled: dc.enabled,
          has_token: dc.hasToken,
          owner_ids: dc.owner_ids,
          owner_only: dc.owner_only,
          names: dc.names,
          knowledge: dc.knowledge,
          reply_when: dc.reply_when,
          rules: dc.rules,
          gate_model: dc.gate_model,
          channels: Object.entries(dc.channels).map(([id, row]) => ({
            id,
            mode: row.mode,
            name: row.name || gateway?.channelName?.(id) || null,
          })),
          ...(gateway ? gateway.status() : lastStatus),
        };
      },

      /** Post as the bot, recorded in the ledger like any answer. */
      async send(channelId, text) {
        if (!gateway) throw new Error("discord is not connected");
        return postDiscord({ transport: gateway, channelId, text, room: gateway.channelName(channelId) });
      },
      async setAvatar(dataUrl) {
        if (!gateway) throw new Error("discord is not connected");
        return gateway.setAvatar(dataUrl);
      },
      /** The server's text rooms, each marked with its mode when it is listed. */
      rooms() {
        if (!gateway) return [];
        const listed = readDiscordConfig().channels;
        return gateway.rooms().map((r) => ({ ...r, mode: listed[r.id]?.mode || null }));
      },
      async history(channelId, opts) {
        if (!gateway) throw new Error("discord is not connected");
        return gateway.history(channelId, opts);
      },
    };
  },
};
