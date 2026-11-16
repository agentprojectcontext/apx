import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import type { Calls } from "../engine/calls.ts";
import type { VoiceEngine } from "../services/voice-engine.ts";
import { waitFor } from "../testkit/platform.ts";
import { attachVoiceCall } from "./voice-call.ts";

const quiet = { info() {}, warn() {}, error() {} };
const ORIGIN = "http://127.0.0.1:7440";

test("what the owner says while the call loads is never heard: the call begins with its greeting", async (t) => {
  // A voice engine that loads, then answers when told to, keeping the audio it gets.
  const heard: string[] = [];
  let toEngine: WebSocket | undefined;
  const voice = new WebSocketServer({ port: 0 });
  voice.on("connection", (ws) => {
    toEngine = ws;
    ws.send(JSON.stringify({ type: "preparing", progress: 0, left_s: 3 }));
    ws.on("message", (d, binary) => {
      if (binary) heard.push(String(d));
    });
  });
  await new Promise((r) => voice.once("listening", r));
  const voiceUrl = `ws://127.0.0.1:${(voice.address() as AddressInfo).port}`;

  const engine = {
    loading: () => false,
    expectedWait: () => undefined,
    whenInstalled: async () => {},
    open: async (_q: unknown, onMessage: (data: WebSocket.RawData, binary: boolean) => void) => {
      const ws = new WebSocket(voiceUrl);
      ws.on("message", onMessage);
      await new Promise((r) => ws.once("open", r));
      return ws;
    },
  } as unknown as VoiceEngine;
  const calls = {
    redeem: () => ({ thread: "th_1", setup: {} }),
    end() {},
    attach() {},
    hear() {},
  } as unknown as Calls;

  const server = http.createServer();
  const relay = attachVoiceCall(server, {
    calls,
    engine,
    gate: { allowedOrigins: new Set([ORIGIN]), token: undefined },
    log: quiet as never,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    relay.close();
    server.close();
    voice.close();
  });

  const frames: { type: string }[] = [];
  const panel = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/voice-call?ticket=x`, {
    origin: ORIGIN,
  });
  t.after(() => panel.close());
  panel.on("message", (d, binary) => {
    if (!binary) frames.push(JSON.parse(String(d)));
  });
  await waitFor(() => frames.some((f) => f.type === "preparing"), "the call to say it is loading");
  await waitFor(() => toEngine, "the call to reach the voice");

  panel.send(Buffer.from("while it loads"));
  await waitFor(() => panel.bufferedAmount === 0, "the early words to leave the panel");
  toEngine?.send(JSON.stringify({ type: "ready" }));
  await waitFor(() => frames.some((f) => f.type === "ready"), "the call to be answered");
  panel.send(Buffer.from("after the greeting"));
  await waitFor(() => heard.length > 0, "the voice to hear the owner");
  assert.deepEqual(heard, ["after the greeting"]);
});
