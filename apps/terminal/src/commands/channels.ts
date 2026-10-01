// apx2 channels / contacts / pairing: the owner's channels, the people on them and who is waiting to be approved.
import type { ApxClient } from "@apx/protocol/client";

const USAGE = {
  channels: `apx2 channels                                  List channels and their state
apx2 channels add telegram <id> --agent <agent>  Add a Telegram bot; reads its token from APX_CHANNEL_TOKEN
apx2 channels rm <id>                            Remove a channel (and its token)
apx2 channels outbox                             What was sent lately and how it went`,
  contacts: `apx2 contacts                                  People and their addresses
apx2 contacts add <name…>                        Add a contact (link addresses with pairing)
apx2 contacts block|unblock <id>
apx2 contacts rm <id>`,
  pairing: `apx2 pairing                                   Strangers waiting for approval
apx2 pairing me <code>                           This address is mine (the owner's)
apx2 pairing ok <code> [name…]                   Approve as a contact
apx2 pairing no <code>`,
};

export async function channels(client: ApxClient, [sub, ...rest]: string[], opts: { agent?: string | undefined }) {
  if (sub === "add") {
    const [type, id] = rest;
    // The token comes in the environment, never on the command line (it would stay in the shell history).
    const token = process.env.APX_CHANNEL_TOKEN;
    if (type !== "telegram" || !id || !opts.agent || !token) throw new Error(USAGE.channels);
    await client.call("channels.set", { id, channel: { type, agent_id: opts.agent }, token });
  } else if (sub === "rm") {
    if (!rest[0]) throw new Error(USAGE.channels);
    await client.call("channels.set", { id: rest[0], channel: null });
  } else if (sub === "outbox") {
    for (const i of (await client.call("channels.outbox", {})).items)
      console.log(
        `${i.created_at.slice(5, 16)}  ${i.state.padEnd(9)} ${i.channel}  ${i.kind.padEnd(7)} ${i.text.replace(/\s+/g, " ").slice(0, 70)}${i.error ? `  (${i.error})` : ""}`,
      );
    return;
  } else if (sub) throw new Error(USAGE.channels);
  const { channels: list } = await client.call("channels.list", {});
  for (const c of list)
    console.log(
      `${c.id.padEnd(14)} ${c.type.padEnd(9)} ${c.status.padEnd(9)} ${(c.account ?? "").padEnd(18)} agent ${c.agent_id}${c.error ? `  — ${c.error}` : ""}`,
    );
  if (!list.length) console.log(`(no channels)\n\n${USAGE.channels}`);
}

export async function contacts(client: ApxClient, [sub, ...rest]: string[]) {
  if (sub === "add" && rest.length) await client.call("contacts.set", { name: rest.join(" ") });
  else if ((sub === "block" || sub === "unblock") && rest[0]) {
    const p = (await client.call("contacts.list", {})).persons.find((x) => x.id === rest[0]);
    if (!p) throw new Error(`no person ${rest[0]}`);
    await client.call("contacts.set", { id: p.id, name: p.name, role: sub === "block" ? "blocked" : "contact" });
  } else if (sub === "rm" && rest[0]) await client.call("contacts.remove", { id: rest[0] });
  else if (sub) throw new Error(USAGE.contacts);
  for (const p of (await client.call("contacts.list", {})).persons)
    console.log(
      `${p.id.padEnd(22)} ${p.role.padEnd(8)} ${p.name}${p.addresses.length ? `  ${p.addresses.map((a) => `${a.channel}:${a.label ?? a.external_id}`).join(", ")}` : ""}`,
    );
}

export async function pairing(client: ApxClient, [sub, code, ...rest]: string[]) {
  const decision = sub === "me" ? "owner" : sub === "ok" ? "contact" : sub === "no" ? "deny" : undefined;
  if (sub && (!decision || !code)) throw new Error(USAGE.pairing);
  if (decision && code) {
    const r = await client.call("pairing.respond", {
      code,
      decision,
      ...(rest.length ? { name: rest.join(" ") } : {}),
    });
    console.log(r.person ? `linked to ${r.person.name}` : "dropped");
    return;
  }
  const { requests } = await client.call("pairing.list", {});
  for (const r of requests)
    console.log(`${r.code}  ${r.channel}  ${r.name}${r.text ? `: ${r.text.slice(0, 60)}` : ""}`);
  if (!requests.length) console.log("(nobody waiting)");
}
