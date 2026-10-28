import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "../../protocol.ts";
import {
  hostPath,
  isAgentEvent,
  isComputerGroup,
  isGeneratingImage,
  responseStatus,
  responseTitle,
  skillChips,
  took,
} from "./blocks.ts";

type Part = Message["parts"][number];
const tool = (name: string, status: "running" | "ok" | "error" = "ok") =>
  ({ type: "tool", call_id: name, tool: name, title: name, status }) as Extract<Part, { type: "tool" }>;

test("a group reads as computer use only when every call is a screen tool", () => {
  assert.equal(isComputerGroup([tool("screen_click"), tool("screen_shot")]), true);
  assert.equal(isComputerGroup([tool("screen_click"), tool("read_file")]), false);
  assert.equal(isComputerGroup([]), false);
});

test("the picture forms only for a running make_image while its run works", () => {
  assert.equal(isGeneratingImage(tool("make_image", "running"), "working"), true);
  assert.equal(isGeneratingImage(tool("make_image", "running"), "input-required"), false);
  assert.equal(isGeneratingImage(tool("make_image", "ok"), "working"), false);
  assert.equal(isGeneratingImage(tool("read_file", "running"), "working"), false);
});

test("skill chips: loaded, strong, hinted with ?, then up to three close considered ones with ~", () => {
  const chips = skillChips({
    type: "skills",
    engine: "local",
    loaded: ["deploy"],
    strong: ["review"],
    hinted: ["docs"],
    scored: [
      { name: "docs", sim: 0.9 },
      { name: "a", sim: 0.5 },
      { name: "b", sim: 0.4 },
      { name: "c", sim: 0.35 },
      { name: "d", sim: 0.32 },
      { name: "far", sim: 0.1 },
    ],
  });
  assert.deepEqual(
    chips.map((chip) => chip.label),
    ["deploy", "review", "docs?", "~a", "~b", "~c"],
  );
});

const message = (author: Message["author"], parts: Part[]) =>
  ({ id: "m", thread_id: "t", seq: 1, author, parts, created_at: "" }) as Message;

test("another agent's message in the owner's chat is an event; the chat's own agent is not", () => {
  const chat = { kind: "agent", agent_ids: ["roby"] };
  const text = { type: "text", text: "hi" } as Part;
  assert.equal(isAgentEvent(chat, message({ kind: "agent", id: "cody" }, [text])), true);
  assert.equal(isAgentEvent(chat, message({ kind: "agent", id: "roby" }, [text])), false);
  assert.equal(
    isAgentEvent({ kind: "group", agent_ids: ["roby"] }, message({ kind: "agent", id: "cody" }, [text])),
    false,
  );
});

test("a completed run that ran out of steps reads as progress, not done", () => {
  assert.equal(responseStatus({ state: "completed", end_reason: "step_limit" }).label, "runStepLimit");
  assert.equal(responseTitle({ state: "completed", end_reason: "step_limit" }), "agentProgress");
  assert.equal(responseTitle({ state: "completed" }), "agentResponse");
  assert.equal(responseStatus({ state: "completed", issue: "no_answer" }).label, "runNoAnswer");
});

test("host and duration read short", () => {
  assert.equal(hostPath("https://www.example.com/docs/"), "example.com/docs");
  assert.equal(took(45_000), "45s");
  assert.equal(took(200_000), "3m 20s");
  assert.equal(took(3_900_000), "1h 5m");
});
