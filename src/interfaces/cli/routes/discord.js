// apx discord — argument routing. No aliases: one spelling per command.
import {
  cmdDiscordStatus,
  cmdDiscordChannels,
  cmdDiscordChannelSet,
  cmdDiscordChannelRemove,
  cmdDiscordSet,
} from "../commands/discord.js";

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  if (sub === "status" || !sub) return cmdDiscordStatus();
  if (sub === "channels") return cmdDiscordChannels();
  if (sub === "set") return cmdDiscordSet(parseArgs(rest.slice(1)), { die });
  if (sub === "channel") {
    const action = rest[1];
    const a = parseArgs(rest.slice(2));
    if (action === "set") return cmdDiscordChannelSet(a._[0], a._[1], a, { die });
    if (action === "remove") return cmdDiscordChannelRemove(a._[0], { die });
    return die(`unknown discord channel action: ${action || "(none)"} — try: set, remove`);
  }
  return die(`unknown discord subcommand: ${sub} — try: status, channels, channel, set`);
}
