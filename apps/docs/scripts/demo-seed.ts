// The demo office the screenshots show: "Acme Store" with Lucía (product), Tomás (developer) and Vera (marketing),
// its tasks, routines, notes, chats and widgets, written through the protocol like any client would.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type Rpc = <T = Record<string, unknown>>(method: string, params?: unknown) => Promise<T>;

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const lines = (...rows: unknown[]) => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;

const AGENTS: Record<string, string> = {
  lucia: `---
name: Lucía
role: Product manager
description: Owns the Acme Store roadmap and hands out the work.
icon: orbita
area: product
autonomy: standard
---
You are Lucía, product manager at Acme Store. Split big asks into tasks, assign them and follow up until they close.
`,
  tomas: `---
name: Tomás
role: Developer
description: Builds and fixes the storefront; opens a Claude Code session for bigger changes.
icon: perla
parent: lucia
area: engineering
tools: [shell, browser]
---
You are Tomás, the developer of the Acme Store storefront. Keep changes small and tested.
`,
  vera: `---
name: Vera
role: Marketing
description: Writes the campaigns, the newsletter and the posts, and schedules them.
icon: cobalto
parent: lucia
area: growth
---
You are Vera, marketing at Acme Store. Friendly, concrete copy; always propose a send date.
`,
  desk: `---
name: Desk
role: Customer desk
description: Answers customers on WhatsApp and escalates only what needs you.
icon: brasa
parent: lucia
area: growth
---
You answer Acme Store's customers. Be brief and kind; never promise refunds without asking the owner.
`,
};

/** A project folder like a real one: AGENTS.md, .apc/ with four agents, some code and a short git history. */
export function writeDemoWorld(dir: string) {
  const repo = path.join(dir, "work", "acme-store");
  write(
    path.join(repo, "AGENTS.md"),
    "# Acme Store\n\nA small online shop: catalog, cart and checkout (TypeScript, Vite).\n\n- `pnpm dev` runs it.\n- Deploys go out on Fridays.\n",
  );
  write(
    path.join(repo, ".apc", "project.json"),
    JSON.stringify({ name: "Acme Store", description: "Our online shop", kind: "company" }, null, 2),
  );
  for (const [slug, text] of Object.entries(AGENTS)) write(path.join(repo, ".apc", "agents", `${slug}.md`), text);
  write(
    path.join(repo, ".apc", "skills", "release-notes", "SKILL.md"),
    "---\nname: release-notes\ndescription: Write the release notes for a storefront deploy from the merged changes.\n---\nList what changed for customers first, then fixes. Keep it under 120 words.\n",
  );
  write(
    path.join(repo, ".apc", "mcps.json"),
    JSON.stringify(
      {
        mcpServers: {
          github: { url: "https://api.githubcopilot.com/mcp/" },
          filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "./src"] },
        },
      },
      null,
      2,
    ),
  );
  write(path.join(repo, "README.md"), "# Acme Store\n\nCatalog, cart and checkout.\n");
  write(
    path.join(repo, "package.json"),
    JSON.stringify({ name: "acme-store", private: true, type: "module" }, null, 2),
  );
  write(
    path.join(repo, "src", "cart.ts"),
    "export type Item = { sku: string; price: number; qty: number };\n\nexport const total = (items: Item[]) =>\n  items.reduce((sum, i) => sum + i.price * i.qty, 0);\n",
  );
  write(
    path.join(repo, "src", "checkout.ts"),
    'import { total, type Item } from "./cart";\n\nexport function applyCoupon(items: Item[], code: string) {\n  const sum = total(items);\n  return code === "FRIDAY" ? sum * 0.9 : sum;\n}\n',
  );
  write(path.join(repo, "src", "catalog.json"), JSON.stringify([{ sku: "mug-01", name: "Mug", price: 14 }], null, 2));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Acme",
        GIT_AUTHOR_EMAIL: "dev@example.com",
        GIT_COMMITTER_NAME: "Acme",
        GIT_COMMITTER_EMAIL: "dev@example.com",
      },
      stdio: "ignore",
    });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "feat: catalog, cart and checkout");
  // A change in progress, for the Changes panel.
  write(
    path.join(repo, "src", "checkout.ts"),
    'import { total, type Item } from "./cart";\n\nexport function applyCoupon(items: Item[], code: string) {\n  if (items.length === 0) return 0;\n  const sum = total(items);\n  return code.trim().toUpperCase() === "FRIDAY" ? sum * 0.9 : sum;\n}\n',
  );

  // A Claude Code and a Codex session started outside APX, for "External sessions".
  const claude = path.join(dir, "claude");
  const codex = path.join(dir, "codex");
  write(
    path.join(claude, "projects", "-work-acme-store", "11111111-2222-3333-4444-555555555555.jsonl"),
    lines(
      { type: "user", cwd: repo, message: { role: "user", content: "Make the coupon field ignore case" } },
      {
        type: "assistant",
        cwd: repo,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done: codes are trimmed and upper-cased before the check." }],
        },
      },
    ),
  );
  write(
    path.join(codex, "sessions", "2026", "10", "06", "rollout-2026-10-06T10-00-00-cdx1.jsonl"),
    lines(
      { type: "session_meta", payload: { id: "cdx1", cwd: repo, originator: "codex_cli_rs" } },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Add a footer with the store's hours" }],
        },
      },
    ),
  );
  return { repo, claude, codex };
}

const WIDGET_SALES = `<!doctype html><html><body style="margin:0;font:14px system-ui;color:#111;padding:14px">
<div style="display:flex;justify-content:space-between;align-items:baseline"><b>Sales this week</b><span style="color:#16a34a">+18%</span></div>
<div style="font-size:30px;font-weight:600;margin:6px 0 10px">$12,480</div>
<svg viewBox="0 0 280 80" width="100%" height="80"><polyline fill="none" stroke="#16a34a" stroke-width="3" points="0,62 40,58 80,50 120,54 160,36 200,30 240,22 280,12"/></svg>
</body></html>`;
const WIDGET_LAUNCH = `<!doctype html><html><body style="margin:0;font:14px system-ui;color:#111;padding:14px">
<b>Q4 launch</b><ul style="padding-left:18px;line-height:1.9;margin:8px 0 0">
<li>✅ Freeze the catalog</li><li>✅ Fix the checkout</li><li>⏳ Landing page and emails</li><li>⬜ Black Friday campaign</li></ul>
</body></html>`;

/** Global skills APX keeps in its home (written before the core starts). */
export function writeHomeSkills(apxHome: string) {
  write(
    path.join(apxHome, "skills", "weekly-brief", "SKILL.md"),
    "---\nname: weekly-brief\ndescription: Turn a week of tasks and chats into a five-line brief for the owner.\n---\nDecisions first, then risks, then what is next.\n",
  );
  write(
    path.join(apxHome, "skills", "customer-reply", "SKILL.md"),
    "---\nname: customer-reply\ndescription: Answer a customer kindly and briefly, without promising refunds.\n---\nThank them, answer, and say who follows up.\n",
  );
}

/** Fills the core: the owner, the crew, tasks, routines, notes, chats, widgets and a Telegram bot. */
export async function seed(rpc: Rpc, world: { repo: string; extension: string }, log: (s: string) => void) {
  const step = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      log(`  ✗ ${what}: ${(e as Error).message}`);
    }
  };
  await step("setup", () => rpc("setup.finish", {}));
  await step("owner", () =>
    rpc("owner.set", { name: "Alex", about: "Runs Acme Store, a small online shop.", language: "en" }),
  );
  await step("extension", () => rpc("extensions.install", { path: world.extension }));
  await step("base", () => rpc("projects.update_base", { name: "Personal", kind: "personal" }));

  const agents = (await rpc<{ agents: Array<{ id: string; name: string; kind?: string }> }>("agents.list")).agents;
  const home = agents.find((a) => a.kind === "secretary") ?? agents[0];
  if (!home) throw new Error("no Home agent");
  await step("home", () => rpc("agents.update", { agent: home.id, name: "Nova", blob: "menta" }));

  const reg = await rpc<{ project: { id: string } }>("projects.register", { path: world.repo });
  const acme = reg.project.id;
  await step("sync", () => rpc("projects.sync", { project: acme }));
  const crew = (await rpc<{ agents: Array<{ id: string; name: string; project_id?: string | null }> }>("agents.list"))
    .agents;
  const id = (name: string) => crew.find((a) => a.name === name && a.project_id === acme)?.id ?? home.id;
  const lucia = id("Lucía");
  const tomas = id("Tomás");
  const vera = id("Vera");

  await step("org", () =>
    rpc("org.set", {
      project: acme,
      organization: {
        areas: [
          { slug: "product", name: "Product", goal: "Ship what customers ask for" },
          { slug: "engineering", name: "Engineering", goal: "A storefront that never breaks" },
          { slug: "growth", name: "Growth", goal: "More repeat customers" },
        ],
        roles: [
          { slug: "pm", name: "Product manager", area: "product" },
          { slug: "dev", name: "Developer", area: "engineering" },
          { slug: "mkt", name: "Marketing", area: "growth" },
        ],
      },
    }),
  );

  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const tasks: Array<Record<string, unknown>> = [
    { title: "Redesign the checkout page", assignee: tomas, status: "doing", priority: "high", tags: ["web"] },
    { title: "Fix broken catalog photos", assignee: tomas, status: "review", priority: "normal" },
    { title: "Black Friday campaign", assignee: vera, status: "todo", priority: "urgent", due_at: day(9) },
    { title: "Spring newsletter", assignee: vera, status: "todo", priority: "low", due_at: day(3) },
    { title: "Define the Q4 roadmap", assignee: lucia, status: "doing", priority: "high", due_at: day(5) },
    { title: "Survey our repeat customers", assignee: lucia, status: "backlog", priority: "normal" },
  ];
  const made: string[] = [];
  for (const t of tasks)
    await step(`task ${t.title}`, async () => {
      made.push((await rpc<{ id: string }>("tasks.create", { project: acme, ...t })).id);
    });
  await step("blocked", async () => {
    const t = await rpc<{ id: string }>("tasks.create", {
      project: acme,
      title: "Approve the launch budget",
      assignee: lucia,
      priority: "high",
    });
    await rpc("tasks.update", { task: t.id, awaits_owner: true });
  });
  await step("comment", () =>
    rpc("tasks.comment", {
      task: made[0],
      text: "@tomás the coupon field breaks when the cart is empty, can you check it?",
    }),
  );
  await step("errand", () =>
    rpc("tasks.create", { title: "Pick up the new packaging samples", kind: "errand", due_at: day(1) }),
  );
  await step("commitments", async () => {
    await rpc("contacts.set", {
      name: "Carla Ruiz",
      relation: "provider",
      note: "Photographer for the store's catalog.",
    });
    await rpc("contacts.set", { name: "Northwind Supplies", relation: "provider", note: "Packaging supplier." });
    await rpc("tasks.create", {
      title: "Send Carla the shot list",
      person: "Carla Ruiz",
      owed_by: "owner",
      due_at: day(2),
    });
    await rpc("tasks.create", {
      title: "Catalog photos delivered",
      person: "Carla Ruiz",
      owed_by: "person",
      due_at: day(6),
    });
    await rpc("tasks.create", {
      title: "Quote for the holiday boxes",
      person: "Northwind Supplies",
      owed_by: "person",
      due_at: day(4),
    });
  });

  const routines: Array<Record<string, unknown>> = [
    {
      name: "Daily summary",
      agent: lucia,
      schedule: { kind: "cron", cron: "0 9 * * 1-5" },
      prompt: "Summarize open tasks: what moved, what is blocked and what needs Alex.",
    },
    {
      name: "Friday newsletter",
      agent: vera,
      schedule: { kind: "cron", cron: "0 9 * * 5" },
      prompt: "Draft this week's newsletter from the new products and send it to Alex for approval.",
    },
    {
      name: "Open pull requests",
      agent: tomas,
      schedule: { kind: "every", minutes: 240 },
      action: "watch",
      prompt: "Tell me only when a pull request needs a review.",
    },
    {
      name: "Nightly backup",
      agent: tomas,
      schedule: { kind: "cron", cron: "30 3 * * *" },
      action: "shell",
      prompt: "Back up the catalog",
      pre_command: "cp src/catalog.json /tmp/catalog.bak",
    },
  ];
  const rids: string[] = [];
  for (const r of routines)
    await step(`routine ${r.name}`, async () => {
      rids.push((await rpc<{ id: string }>("routines.set", { project: acme, ...r })).id);
    });
  for (const r of rids.slice(0, 2)) await step("run", () => rpc("routines.run", { routine: r }));

  const notes: Array<Record<string, unknown>> = [
    { text: "Alex prefers short answers with the decision first.", scope: "global" },
    { text: "Alex's time zone is New York; no messages before 8:00.", scope: "global" },
    { text: "Deploys go out on Fridays after 10:00.", scope: "project", project: acme },
    { text: "Black Friday discount is 20% on bundles, 10% on singles.", scope: "project", project: acme },
    { text: "The coupon field must ignore case and spaces.", scope: "agent", project: acme, agent: tomas },
    {
      text: "Newsletter goes out Friday 9:00; subject under 50 characters.",
      scope: "agent",
      project: acme,
      agent: vera,
    },
  ];
  for (const n of notes) await step("note", () => rpc("memory.add", n));

  // Chats: Home and Lucía answer through the scripted model.
  const send = async (thread: string, text: string) => {
    const { run } = await rpc<{ run: { id: string } }>("threads.send", { thread, text });
    await rpc("runs.wait", { run: run.id, timeout_s: 30 });
  };
  await step("home chat", async () => {
    await send("home", "What's on my plate today?");
    await send("home", "Yes, ping Lucía that I'll look at it after lunch.");
  });
  let luciaChat = "";
  await step("lucia chat", async () => {
    luciaChat = (
      await rpc<{ id: string }>("threads.create", {
        kind: "agent",
        agent_id: lucia,
        project_id: acme,
        title: "Q4 launch",
      })
    ).id;
    await send(luciaChat, "Plan the Q4 launch with the team, four weeks.");
  });
  await step("tomas chat", async () => {
    const t = (
      await rpc<{ id: string }>("threads.create", {
        kind: "agent",
        agent_id: tomas,
        project_id: acme,
        title: "Checkout fix",
      })
    ).id;
    await send(t, "Can you check the checkout? Customers say the coupon fails.");
  });
  await step("vera chat", async () => {
    const t = (
      await rpc<{ id: string }>("threads.create", {
        kind: "agent",
        agent_id: vera,
        project_id: acme,
        title: "Friday newsletter",
      })
    ).id;
    await send(t, "Draft the newsletter for Friday.");
  });

  await step("widgets", async () => {
    const thread =
      luciaChat ||
      (await rpc<{ id: string }>("threads.create", { kind: "agent", agent_id: lucia, project_id: acme })).id;
    await rpc("surfaces.show", {
      name: "weekly-sales",
      title: "Sales this week",
      html: WIDGET_SALES,
      pinned: true,
      app: true,
      thread,
    });
    await rpc("surfaces.show", { name: "q4-launch", title: "Q4 launch", html: WIDGET_LAUNCH, pinned: true, thread });
  });
  return { acme, home: home.id, lucia, tomas, vera, luciaChat };
}
