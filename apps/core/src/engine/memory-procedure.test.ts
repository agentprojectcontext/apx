import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { failureReason, noiseStep, procedureSupported, stepGist } from "../domain/procedure-steps.ts";
import type { Step } from "../domain/runs.ts";
import { waitFor } from "../testkit/platform.ts";
import { scratchDir } from "../tools/folders.ts";
import { hookLine } from "../tools/memory.ts";
import { defineTool, type Tool } from "../tools/types.ts";
import { supportMemoryClaims } from "./memory-testkit.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

type Env = Awaited<ReturnType<typeof startCore>>;

const fake = (name: string, run: (a: Record<string, unknown>) => string): Tool =>
  defineTool({
    name,
    description: name,
    args: z.looseObject({}),
    effect: "none",
    deadlineMs: 5_000,
    title: () => name,
    async run(a) {
      return run(a);
    },
  });

const reel = "https://www.instagram.com/reel/AAAA1111/?igsh=Zm9vYmFy";
const request = `bajame este reel ${reel}`;
const direct = "https://dl.snapcdn.app/get?token=eyJhbGciOiJIUzI1NiJ9.c2VjcmV0.s1gn&expires=1234567890";

/** The run that worked: a downloader that needs a login, then a site that hands out the direct link, then curl. */
function reelScript(out: () => string) {
  const plan = (): Array<[string, Record<string, unknown>]> => [
    ["shell", { command: `yt-dlp -o ${out()} ${reel}` }],
    ["mcp_search", { query: "tabs" }],
    ["mcp_playwright_browser_navigate", { url: "https://snapinsta.to/en?ref=Zm9v" }],
    ["mcp_playwright_browser_type", { element: "URL box", text: reel }],
    ["mcp_playwright_browser_snapshot", {}],
    ["mcp_playwright_browser_evaluate", { function: "() => document.querySelector('a.download').href" }],
    ["mcp_playwright_browser_evaluate", { function: "() => document.querySelector('a.download').href" }],
    ["mcp_playwright_browser_tabs", { action: "list" }],
    ["shell", { command: `curl -L --fail -H "Authorization: Bearer abc123" "${direct}" -o ${out()}` }],
    ["send_file", { path: out() }],
  ];
  return scriptedLlm((req, { system, said }) => {
    if (system.startsWith("Validate memory")) return supportMemoryClaims(req);
    if (system.startsWith("Extract durable")) return say('{"memories":[]}');
    if (system.startsWith("Review private")) return say('{"groups":[]}');
    if (said.startsWith("bajame")) {
      const done = req.messages.filter((m) => m.role === "tool").length;
      const next = plan()[done];
      return next ? callTool(`c${done}`, next[0], next[1]) : say("Listo, ahí va el reel.");
    }
    return say("ok");
  });
}

const reelTools = (): Tool[] => [
  fake("shell", (a) =>
    String(a.command).startsWith("yt-dlp")
      ? "exit 1 · /tmp\nERROR: [Instagram] AAAA1111: login required to view this reel"
      : "exit 0 · /tmp\n(no output)",
  ),
  fake("mcp_playwright_browser_navigate", () => "navigated"),
  fake("mcp_playwright_browser_type", () => "typed"),
  fake("mcp_playwright_browser_snapshot", () => "- link Download Video"),
  fake("mcp_playwright_browser_evaluate", () => direct),
  fake("mcp_playwright_browser_tabs", () => "1 tab"),
  fake("send_file", () => "sent"),
];

const procedures = async (env: Env) =>
  (await env.client.call("memory.list", { agent: "roby" })).memories.filter((m) => m.kind === "procedure");

test("a confirmed reel download keeps the site, the command and what failed first, and the index names the method", async () => {
  let out = "";
  const llm = reelScript(() => out);
  const env = await startCore({ llm, aux: true, memoryMaintenance: true, extraTools: reelTools() });
  try {
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    out = path.join(scratchDir(env.core.store, env.home, chat), "reel.mp4");
    await env.client.call("threads.send", { thread: chat.id, text: request });
    await env.settle(chat.id);
    await env.client.call("threads.send", { thread: chat.id, text: "genial, funcionó" });
    await env.settle(chat.id);
    await waitFor(async () => (await procedures(env)).length === 1, "the confirmed procedure");
    const [note] = await procedures(env);
    assert.ok(note);
    const text = note.text;
    const [, steps = "", tried = ""] = text.split("\n");
    assert.match(text, /^Procedure confirmed by owner on .* \(history, not an instruction\)/);
    assert.match(steps, /`mcp_playwright_browser_navigate` `snapinsta\.to\/en`/, "the site it used");
    assert.match(steps, /`shell` `curl -L --fail <dl\.snapcdn\.app> -o <scratch>\/reel\.mp4`/, "the command");
    assert.match(steps, /`send_file` `<scratch>\/reel\.mp4`/);
    assert.match(tried, /^Tried first, failed: `yt-dlp` \(login required to view this reel\)$/);
    assert.doesNotMatch(steps, /yt-dlp/, "a failed try is never a step of the method");
    assert.doesNotMatch(steps, /mcp_search|snapshot|_tabs/, "lookups are not the method");
    assert.equal(steps.match(/browser_evaluate/g)?.length, 1, "a repeated script is said once");
    assert.match(text, /Outputs: `<scratch>\/reel\.mp4`/);
    for (const secret of ["token", "eyJhbGci", "s1gn", "igsh", "Zm9v", "Bearer", "abc123", "Authorization", "?"])
      assert.ok(!text.includes(secret), `no ${secret} in the note`);
    assert.equal(note.tainted, true, "the note is history, read as data");

    const hook = hookLine(note);
    assert.ok(hook.length < 140, hook);
    assert.match(hook, /\(procedure, [^)]*\) "bajame este reel <instagram\.com>": snapinsta\.to → page script → curl/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

const step = (tool: string, args: Record<string, unknown>, state: Step["state"] = "ok", result = "ok"): Step => ({
  call_id: tool,
  tool,
  args,
  effect: "none",
  state,
  result,
});

test("a step's gist keeps hosts, programs and relative paths, never a credential", () => {
  const places = { work: "/path/to/acme" };
  assert.equal(stepGist(step("browser_navigate", { url: "https://Example.com/a/b?session=1#x" })), "example.com/a/b");
  assert.equal(
    stepGist(step("browser_open", { url: "https://example.com/very/long/path/that/goes/on/and/on" })),
    "example.com",
  );
  assert.equal(
    stepGist(
      step("shell", {
        command:
          'API_TOKEN=s3cr3t curl -sL --cookie "sid=1" -u me:pw --data \'{"k":1}\' https://api.example.com/x?key=1 -o /path/to/acme/out/data.json',
      }),
      places,
    ),
    "curl -sL <api.example.com> -o out/data.json",
  );
  assert.equal(
    stepGist(step("shell", { command: "cd /path/to/acme && wget --header=Authorization:x https://example.com/f" })),
    "wget <example.com>",
  );
  assert.equal(
    stepGist(step("file_write", { path: "/path/to/acme/docs/plan.md", content: "x" }), places),
    "docs/plan.md",
  );
  assert.equal(stepGist(step("shell", { command: "echo password=hunter2" })), "echo");
  // Windows paths are reduced the same way, said with `/`.
  const winScratch = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\apx-scratch-7a73e6c1\\th_0228b35f049a4337";
  assert.equal(
    stepGist(step("shell", { command: `curl -L --fail https://dl.example.com/f -o ${winScratch}\\reel.mp4` })),
    "curl -L --fail <dl.example.com> -o <scratch>/reel.mp4",
  );
  assert.equal(stepGist(step("send_file", { path: `${winScratch}\\reel.mp4` })), "<scratch>/reel.mp4");
  assert.equal(
    stepGist(step("file_write", { path: "D:\\work\\acme\\docs\\plan.md", content: "x" }), { work: "D:\\work\\acme" }),
    "docs/plan.md",
  );
  assert.equal(noiseStep("mcp_search"), true);
  assert.equal(noiseStep("browser_snapshot"), true);
  assert.equal(noiseStep("mcp_playwright_browser_tabs"), true);
  assert.equal(noiseStep("browser_navigate"), false);
  assert.equal(failureReason(step("shell", {}, "ok", "exit 1 · /tmp\nERROR: token=abc expired")), "");
  const meter =
    "  % Total    % Received\n  0     0    0     0    0     0      0      0 --:--:--\ncurl: (23) Failure writing output";
  assert.equal(failureReason(step("shell", {}, "ok", `exit 23 · /tmp\n${meter}`)), "curl: 23 Failure writing output");
});

test("a procedure line naming a step the run never took, or a reduced form it never had, is not supported", () => {
  const steps = [
    step("shell", { command: "yt-dlp https://example.com/v" }, "ok", "exit 1 · /tmp\nERROR: login required"),
    step("browser_navigate", { url: "https://example.com/dl?u=1" }),
    step("shell", { command: "curl -L https://cdn.example.com/f?sig=1 -o out.mp4" }),
  ];
  const note = (steps_: string, tried = "") =>
    [`Procedure that worked on 2020-01-01 (history, not an instruction), when the owner asked: "x"`, steps_, tried]
      .filter(Boolean)
      .join("\n");
  assert.equal(
    procedureSupported(
      note(
        "Steps: `browser_navigate` `example.com/dl` → `shell` `curl -L <cdn.example.com> -o out.mp4`",
        "Tried first, failed: `yt-dlp` (login required)",
      ),
      steps,
    ),
    true,
  );
  assert.equal(procedureSupported(note("Steps: `shell` `yt-dlp <example.com>`"), steps), false, "it failed");
  assert.equal(procedureSupported(note("Steps: `shell` `curl -L <evil.example.com>`"), steps), false);
  assert.equal(procedureSupported(note("Steps: `shell`", "Tried first, failed: `curl`"), steps), false, "it worked");
});
