import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { openLine } from "./callLine.ts";

function setup(t: TestContext) {
  let stopped = 0;
  let closed = 0;
  let port: { onmessage: ((event: { data: ArrayBuffer }) => void) | null } | undefined;
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 0;
    binaryType = "";
    onopen?: () => void;
    onmessage?: unknown;
    onclose?: () => void;
    sent: unknown[] = [];
    constructor(_url: string) {
      sockets.push(this);
    }
    send(data: unknown) {
      this.sent.push(data);
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1 } });
  class Context {
    audioWorklet = { addModule: async () => {} };
    destination = {};
    createGain = node;
    createMediaStreamSource = node;
    createMediaStreamDestination = () => ({ stream: { getAudioTracks: () => [] } });
    async resume() {}
    async close() {
      closed++;
    }
  }
  const replace = (name: string, value: unknown) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  };
  replace(
    "RTCPeerConnection",
    class {
      close() {}
      async createOffer() {
        throw new Error("no loopback in this fixture");
      }
    },
  );
  replace(
    "Audio",
    class {
      srcObject = null;
      pause() {}
    },
  );
  replace("AudioContext", Context);
  replace(
    "AudioWorkletNode",
    class {
      port = { onmessage: null };
      constructor() {
        port = this.port;
      }
    },
  );
  replace("WebSocket", Socket);
  replace("window", { location: { protocol: "http:", host: "localhost" } });
  const mic = {
    getTracks: () => [
      {
        stop() {
          stopped++;
        },
      },
    ],
  } as unknown as MediaStream;
  return {
    mic,
    sockets,
    send: (data: ArrayBuffer) => {
      assert.ok(port?.onmessage);
      port.onmessage({ data });
    },
    stopped: () => stopped,
    closed: () => closed,
  };
}

function ticket() {
  let release = (_key: string) => {};
  let requested = () => {};
  const asking = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const key = new Promise<string>((resolve) => {
    release = resolve;
  });
  return {
    asking,
    release,
    request: () => {
      requested();
      return key;
    },
  };
}

test("the first phrase after the greeting is captured while calls.start is delayed", async (t) => {
  const env = setup(t);
  const pending = ticket();
  const now = 10_000;
  t.mock.method(Date, "now", () => now);
  const line = openLine(env.mic, pending.request, { frame() {}, closed() {} }, now + 100);
  await pending.asking;
  const echo = new ArrayBuffer(2);
  env.send(echo);
  t.mock.method(Date, "now", () => now + 1000);
  const phrase = new ArrayBuffer(4);
  env.send(phrase);
  assert.equal(env.sockets.length, 0);
  pending.release("one-use-ticket");
  const connected = await line;
  const socket = env.sockets[0];
  assert.ok(socket);
  socket.readyState = 1;
  socket.onopen?.();
  assert.deepEqual(socket.sent, [phrase]);
  connected.hangUp();
  assert.equal(env.stopped(), 1);
  assert.equal(env.closed(), 2);
});

test("hanging up during calls.start releases the microphone immediately and never opens a late socket", async (t) => {
  const env = setup(t);
  const pending = ticket();
  const controller = new AbortController();
  const line = openLine(env.mic, pending.request, { frame() {}, closed() {} }, 0, controller.signal);
  const rejected = assert.rejects(line, { name: "AbortError" });
  await pending.asking;
  controller.abort();
  assert.equal(env.stopped(), 1);
  assert.equal(env.closed(), 2);
  pending.release("late-ticket");
  await rejected;
  assert.equal(env.sockets.length, 0);
});
