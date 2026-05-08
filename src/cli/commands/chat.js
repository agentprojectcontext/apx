import readline from "node:readline";
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

export async function cmdChat(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx chat: usage: apx chat <agent> [--conversation <id>] [--model <id>]");

  const pid = await resolveProjectId(args?.flags?.project);
  let convId = args.flags.conversation === true ? null : args.flags.conversation || null;
  const overrideModel = args.flags.model === true ? null : args.flags.model || null;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${slug}> `,
    terminal: process.stdin.isTTY,
  });

  console.log(`apx chat with ${slug}${convId ? ` (cont. ${convId})` : ""} — type Ctrl-D or 'exit' to quit`);
  rl.prompt();

  rl.on("line", async (line) => {
    const text = line.trim();
    if (text === "exit" || text === "quit") {
      rl.close();
      return;
    }
    if (!text) {
      rl.prompt();
      return;
    }
    try {
      const body = { prompt: text };
      if (convId) body.conversation_id = convId;
      if (overrideModel) body.model = overrideModel;

      const result = await http.post(`/projects/${pid}/agents/${slug}/chat`, body);
      convId = result.conversation_id;
      process.stdout.write("\n" + result.text + "\n\n");
    } catch (e) {
      process.stderr.write(`apx: ${e.message}\n`);
    }
    rl.prompt();
  });

  rl.on("close", () => {
    process.stdout.write("\n");
    process.exit(0);
  });
}

export async function cmdConversationsList(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx conversations list: missing <agent-slug>");
  const pid = await resolveProjectId(args?.flags?.project);
  const rows = await http.get(`/projects/${pid}/agents/${slug}/conversations`);
  if (rows.length === 0) {
    console.log("(no conversations)");
    return;
  }
  console.log("ID".padEnd(16) + " ENGINE".padEnd(35) + " TURNS  STATUS");
  for (const r of rows) {
    const id = r.filename.replace(/\.md$/, "");
    console.log(
      id.padEnd(16) +
      " " + (r.engine || "?").padEnd(34) +
      " " + String(r.turn_count || 0).padEnd(6) +
      " " + (r.status || "open")
    );
  }
}

export async function cmdConversationsGet(args) {
  const slug = args._[0];
  const id = args._[1];
  if (!slug || !id) throw new Error("apx conversations get: usage: apx conversations get <agent> <id>");
  const pid = await resolveProjectId(args?.flags?.project);
  const conv = await http.get(`/projects/${pid}/agents/${slug}/conversations/${id}`);
  process.stdout.write(`# Conversation ${id} (${slug})\n`);
  for (const t of conv.turns) {
    process.stdout.write(`\n## ${t.role} — ${t.ts}\n${t.content}\n`);
  }
}
