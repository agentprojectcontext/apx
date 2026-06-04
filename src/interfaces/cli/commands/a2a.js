import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

export async function cmdSend(args) {
  const from = args._[0];
  const to = args._[1];
  if (!from || !to) {
    throw new Error('apx send: usage: apx send <from> <to> "<body>" [--deliver]');
  }
  let body = args._.slice(2).join(" ").trim();
  if (!body || body === "-") {
    const fs = await import("node:fs");
    if (!process.stdin.isTTY) {
      const chunks = [];
      const buf = Buffer.alloc(65536);
      try {
        while (true) {
          const n = fs.readSync(0, buf, 0, buf.length);
          if (!n) break;
          chunks.push(buf.slice(0, n).toString("utf8"));
        }
      } catch {}
      body = chunks.join("").trim();
    }
  }
  if (!body) throw new Error("apx send: body is empty");

  const pid = await resolveProjectId(args?.flags?.project);
  const result = await http.post(`/projects/${pid}/send`, {
    from,
    to,
    body,
    deliver: !!args.flags.deliver,
  });
  console.log(`✉  ${from} → ${to}  @ ${result.ts}`);
  console.log(`   ${body}`);
  if (result.reply) {
    if (result.reply.error) {
      console.log(`\n⚠  delivery failed: ${result.reply.error}`);
    } else {
      console.log(`\n← ${to} replies:`);
      console.log(result.reply.text);
    }
  }
}

export async function cmdConnections(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx connections: missing <agent-slug>");
  const pid = await resolveProjectId(args?.flags?.project);
  const peers = await http.get(`/projects/${pid}/agents/${slug}/connections`);
  if (peers.length === 0) {
    console.log(`(no connections logged for ${slug} yet)`);
    return;
  }
  console.log("PEER".padEnd(16) + " CH".padEnd(11) + " DIR  N    LAST");
  for (const p of peers) {
    console.log(
      (p.peer || "?").padEnd(16) + " " +
      (p.channel || "").padEnd(10) + " " +
      (p.direction || "").padEnd(4) + " " +
      String(p.n).padEnd(4) + " " +
      (p.last_ts || "")
    );
  }
}
