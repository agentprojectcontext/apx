// Sender identity resolution for Telegram (and, by reuse, any future channel).
//
// The unit of identity is the PERSON, keyed by their stable platform user id
// (Telegram `msg.from.id`) — never the chat_id (breaks in groups) nor the phone
// (Telegram doesn't expose it). A person is the same across every channel/chat;
// their role lives on the global contact entry. The per-channel `owner_user_id`
// only marks who owns *that* channel and overrides the role to "owner" there.
//
// resolveSender() is pure (read-only). registerSender() has the side effect of
// recording unknown senders and claiming the first private-chat sender as the
// channel owner when none is set yet.

import {
  readConfig,
  findContact,
  findTelegramChannel,
  upsertContact,
  upsertTelegramChannel,
} from "../config/index.js";

function telegramDisplayName(from) {
  const full = [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
  return full || from?.username || "unknown";
}

/**
 * Resolve who the sender is, relative to a channel. Read-only.
 * @returns {{userId, username, name, role, isOwner, isGroup, known, note}}
 */
export function resolveSender({ cfg, channelName, from, chatType }) {
  const userId = from?.id ?? null;
  const username = from?.username || "";
  const channel = channelName ? findTelegramChannel(cfg, channelName) : null;
  const contact = userId != null ? findContact(cfg, userId) : null;
  const isGroup = chatType === "group" || chatType === "supergroup";
  const isOwner =
    channel?.owner_user_id != null &&
    String(channel.owner_user_id) === String(userId);
  const role = isOwner ? "owner" : contact?.role || "guest";
  return {
    userId,
    username,
    name: contact?.name || telegramDisplayName(from),
    role,
    isOwner,
    isGroup,
    known: !!contact || isOwner,
    note: contact?.note || "",
  };
}

/**
 * Resolve the tool allowlist for a sender's role.
 *  - owner → "*" (all tools)
 *  - guest → [] (no tools; text only)
 *  - a role defined in telegram.roles → its `tools` ("*" or an array)
 *  - any other named role with no definition → "*" (an admin assigned it
 *    deliberately; default permissive rather than silently muting it)
 * Returns "*" or an array of tool names.
 */
export function resolveAllowedTools(cfg, sender) {
  if (sender?.isOwner) return "*";
  const def = cfg?.telegram?.roles?.[sender?.role];
  if (def && def.tools !== undefined) return def.tools;
  if (sender?.role === "guest") return [];
  return "*";
}

/**
 * Like resolveSender(), but records the sender if unrecognized.
 *  - Private chat + channel has no owner yet → claim this sender as owner.
 *  - Otherwise an unknown sender is recorded as a role-less guest.
 *  - A known sender's last_seen is refreshed at most once per day.
 *
 * Persistence is done against a FRESH on-disk config (so concurrent edits from
 * the web/CLI aren't clobbered and the file isn't ballooned with merged
 * defaults). The in-memory `cfg.telegram` subtree is then refreshed so later
 * messages in this daemon session see the change without a reload.
 * Returns { sender, mutated }.
 */
export function registerSender({ cfg, channelName, from, chatType }) {
  const userId = from?.id ?? null;

  // Always refresh the in-memory telegram subtree from disk so role/owner
  // edits made via CLI/web/API are honored on the very next message without a
  // daemon reload. Telegram traffic is low-frequency, so a config read per
  // inbound message is cheap. The helpers below mutate `disk` in place and
  // persist; since cfg.telegram now references it, the session stays current.
  const disk = readConfig();
  cfg.telegram = disk.telegram;

  const base = () => resolveSender({ cfg, channelName, from, chatType });
  if (userId == null) return { sender: base(), mutated: false };

  const channel = channelName ? findTelegramChannel(disk, channelName) : null;
  const isPrivate = chatType === "private";
  const existing = findContact(disk, userId);
  const now = new Date().toISOString();
  const username = from?.username || "";
  const name = telegramDisplayName(from);

  const ownerUnset =
    channel && (channel.owner_user_id == null || channel.owner_user_id === "");

  let kind = null; // "claim" | "guest" | "touch"
  if (isPrivate && ownerUnset) kind = "claim";
  else if (!existing) kind = "guest";
  else if (existing.last_seen?.slice(0, 10) !== now.slice(0, 10)) kind = "touch";

  if (!kind) return { sender: base(), mutated: false };

  if (kind === "claim") {
    upsertTelegramChannel(disk, channelName, { owner_user_id: userId });
    upsertContact(disk, userId, {
      name, username, role: "owner", first_seen: now, last_seen: now,
    });
  } else if (kind === "guest") {
    upsertContact(disk, userId, {
      name, username, role: "guest", first_seen: now, last_seen: now,
    });
  } else {
    upsertContact(disk, userId, { last_seen: now });
  }

  return { sender: base(), mutated: true };
}
