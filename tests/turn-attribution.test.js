// Turn attribution: every agent turn must record WHICH agent answered, on WHICH
// model, and what it cost. The store-level read side is covered in
// super-agent-threads.test.js; these guard the WRITE side — the channels that
// persist a turn — plus the one place the web client used to conflate the agent
// persona (`name`) with the engine (`model`).
//
// Source-shape assertions, like telegram-fallback.test.js: exercising the real
// channels needs a live Telegram/desktop stack, and `appendGlobalMessage` writes
// to the user's real ~/.apx/messages (no dir injection), so a functional test
// here would pollute it.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");

const REPLY = read("core", "channels", "telegram", "reply.js");
const DISPATCH = read("core", "channels", "telegram", "dispatch.js");
const ASK_CALLBACKS = read("core", "channels", "telegram", "ask-callbacks.js");
const API_SUPER_AGENT = read("host", "daemon", "api", "super-agent.js");
const API_VOICE = read("host", "daemon", "api", "voice.js");
const DESKTOP = read("host", "daemon", "plugins", "desktop", "index.js");
const USE_CHAT = read("interfaces", "web", "src", "hooks", "useChat.ts");

test("telegram: the stream handler tracks the model that is answering now", () => {
  // A turn can rotate models mid-flight (routing fallback). Records written
  // while streaming must carry the model that produced THEM, not the one the
  // turn happened to end on.
  assert.match(
    REPLY,
    /model_start[\s\S]{0,160}state\.model\s*=\s*ev\.model/,
    "buildStreamHandler must latch ev.model from the model_start/model_routed events",
  );
  assert.match(
    REPLY,
    /streamed: true[\s\S]{0,80}model: state\.model/,
    "streamed assistant pieces must be stamped with the live model",
  );
});

test("telegram: sendFinalReply persists the model alongside usage", () => {
  assert.match(REPLY, /saModel\s*=\s*null/, "sendFinalReply must accept saModel");
  assert.match(
    REPLY,
    /if \(saUsage\) meta\.usage = saUsage;\s*\n\s*if \(saModel\) meta\.model = saModel;/,
    "the final record must carry both usage and model",
  );
});

test("telegram: every entry point hands the model to sendFinalReply", () => {
  for (const [name, src] of [
    ["dispatch.js", DISPATCH],
    ["ask-callbacks.js (runResumedTurn)", ASK_CALLBACKS],
    ["reply.js (runFollowupTurn)", REPLY],
  ]) {
    assert.match(src, /saModel[:,]/, `${name} must pass saModel through to sendFinalReply`);
  }
  // The routed project-agent branch has no super-agent result to read the model
  // from — it must fall back to the agent card's own Model field.
  assert.match(
    DISPATCH,
    /replyModel = agent\.fields\.Model/,
    "a routed project agent must still record which model it ran on",
  );
});

test("web/desktop/voice: persisted agent turns carry model and usage", () => {
  // The signature may grow (trace, project…); what must never drop out is the
  // attribution pair.
  assert.match(
    API_SUPER_AGENT,
    /function logWebTurn\(channel, \{ prompt, replyText, name, model, usage[\w\s,]*\}\)/,
    "logWebTurn must receive the attribution",
  );
  assert.match(
    API_SUPER_AGENT,
    /logWebTurn\(ctx\.channel, \{\s*prompt,\s*replyText: saResult\.text,\s*name: saResult\.name,\s*model: saResult\.model,\s*usage: saResult\.usage,/,
    "both endpoints must hand the attribution to logWebTurn",
  );
  assert.match(
    API_SUPER_AGENT,
    /meta: \{\s*\.\.\.scope,\s*\.\.\.\(model \? \{ model \} : \{\}\),\s*\.\.\.\(usage \? \{ usage \} : \{\}\),/,
    "the persisted turn's meta must stamp model and usage",
  );
  for (const [name, src, modelExpr, usageExpr] of [
    ["desktop", DESKTOP, /\{ model: result\.model \}/, /\{ usage: result\.usage \}/],
    ["voice", API_VOICE, /\{ model: replyModel \}/, /\{ usage: replyUsage \}/],
  ]) {
    assert.match(src, modelExpr, `${name} must stamp the model on the persisted turn`);
    assert.match(src, usageExpr, `${name} must stamp the usage on the persisted turn`);
  }
});

test("stream: the final event exposes the engine separately from the persona", () => {
  // `name` is the persona (Roby); `model` is the engine that answered. The web
  // client used to read `name` as the model, which is why the footer showed a
  // persona where a model id belonged.
  assert.match(
    API_SUPER_AGENT,
    /name: saResult\.name,\s*\n\s*model: saResult\.model,/,
    "the final event must send name and model as distinct fields",
  );
  assert.match(
    USE_CHAT,
    /model: turn\.model \?\? ev\.result\?\.model,\s*\n\s*agent: turn\.agent \?\? ev\.result\?\.name,/,
    "applyStreamEvent must not fall back from model to name",
  );
});

test("web: a reloaded thread splits turns when the answering agent changes", () => {
  assert.match(
    USE_CHAT,
    /m\.role === "assistant" && actor !== turnActor/,
    "threadToChatMsgs must start a new bubble when the actor changes",
  );
});
