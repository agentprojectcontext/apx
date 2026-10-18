import { act, renderHook } from "@testing-library/react-native";
import { newChatId } from "../src/chat/newChat";
import { useThread } from "../src/hooks/useThread";
import type { Message, Thread } from "../src/protocol";
import { credentials, deferred, transport } from "./transport.test-support";

let net: ReturnType<typeof transport>;
const unpair = jest.fn();
const thread = { id: "thr_one", kind: "loose", state: "idle", title: "Work", agent_ids: ["april"] } as Thread;
const message = (id: string, seq: number, text: string, author: "user" | "agent" = "agent"): Message => ({
  id,
  thread_id: thread.id,
  seq,
  author: author === "agent" ? { kind: "agent", id: "april" } : { kind: "user" },
  parts: [{ type: "text", text }],
  created_at: "2026-10-18T10:00:00Z",
});
const snapshot = (messages: Message[] = []) => ({ thread, messages, runs: [] });
const mount = (id = thread.id) => renderHook(() => useThread(credentials, id, unpair));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
  net = transport();
  net.responses["threads.get"] = snapshot();
});
afterEach(() => {
  net.restore();
  jest.useRealTimers();
});

test("a thread subscribes before loading, orders messages and selects the newest reported context usage", async () => {
  net.responses["threads.get"] = {
    ...snapshot([message("msg_b", 2, "Second"), message("msg_a", 1, "First")]),
    runs: [
      { started_at: "2026-10-18T10:00:00Z", usage: { context: 10, window: 100 } },
      { started_at: "2026-10-18T12:00:00Z", usage: {} },
      { started_at: "2026-10-18T11:00:00Z", usage: { context: 30, window: 100 } },
    ],
  };
  const hook = await mount();
  expect(hook.result.current.online).toBe(true);
  expect(hook.result.current.messages.map((item) => item.id)).toEqual(["msg_a", "msg_b"]);
  expect(hook.result.current.usage).toEqual({ context: 30, window: 100 });
  expect(hook.result.current.thread?.id).toBe(thread.id);
  await hook.unmount();
  expect(net.sockets[0]?.readyState).toBe(3);
});

test("a not-yet-created chat connects without requesting a thread that does not exist", async () => {
  const hook = await mount(newChatId({ agent: "april" }));
  expect(hook.result.current.online).toBe(true);
  expect(hook.result.current.messages).toEqual([]);
  expect(net.calls).toEqual([]);
  await hook.unmount();
});

test("streamed parts, deletions and newer thread state survive an older pending snapshot", async () => {
  const pending = deferred<ReturnType<typeof snapshot>>();
  net.responses["threads.get"] = () => pending.promise;
  const hook = await mount();
  const socket = net.sockets[0];
  expect(socket).toBeDefined();
  await act(async () => {
    socket?.event({ type: "message.created", message: message("msg_live", 2, "Hello") });
    socket?.event({
      type: "message.part",
      thread_id: thread.id,
      message_id: "msg_live",
      index: 0,
      part: { type: "text", text: "Hello world" },
    });
    socket?.event({ type: "message.deleted", thread_id: thread.id, message_ids: ["msg_old"] });
    socket?.event({ type: "thread.updated", thread: { ...thread, state: "working" } });
    pending.resolve(snapshot([message("msg_live", 2, "Old"), message("msg_old", 1, "Deleted")]));
  });
  expect(hook.result.current.messages).toEqual([message("msg_live", 2, "Hello world")]);
  expect(hook.result.current.state).toBe("working");
  expect(hook.result.current.thread?.state).toBe("working");
  await hook.unmount();
});

test("a missing event sequence refetches once and another thread's messages never enter this feed", async () => {
  const hook = await mount();
  net.calls.length = 0;
  await act(async () => {
    net.sockets[0]?.event({ type: "thread.updated", thread }, "core", 1);
    net.sockets[0]?.event(
      { type: "message.created", message: { ...message("msg_elsewhere", 1, "Private"), thread_id: "thr_other" } },
      "core",
      4,
    );
    net.sockets[0]?.event({ type: "thread.updated", thread }, "core", 9);
  });
  expect(hook.result.current.messages).toEqual([]);
  await act(() => jest.advanceTimersByTimeAsync(300));
  expect(net.calls.filter((call) => call.method === "threads.get")).toHaveLength(1);
  await hook.unmount();
});

test("sending inserts an optimistic message, forwards attachments and preserves live working state on acknowledgement", async () => {
  const pending = deferred<{ message: Message }>();
  net.responses["threads.send"] = () => pending.promise;
  const hook = await mount();
  let sending: Promise<void> | undefined;
  await act(async () => {
    sending = hook.result.current.send("Review", ["att_one"]);
  });
  expect(hook.result.current.messages).toHaveLength(1);
  expect(hook.result.current.messages[0]?.id).toMatch(/^local_/);
  expect(net.calls.at(-1)).toEqual({
    method: "threads.send",
    params: { thread: thread.id, text: "Review", mode: "queue", attachments: ["att_one"] },
  });
  await act(async () => {
    net.sockets[0]?.event({ type: "thread.updated", thread: { ...thread, state: "working" } });
    pending.resolve({ message: message("msg_saved", 1, "Review", "user") });
    await sending;
  });
  expect(hook.result.current.messages).toEqual([message("msg_saved", 1, "Review", "user")]);
  expect(hook.result.current.state).toBe("working");
  await hook.unmount();
});

test("a failed send removes only its own optimistic message and leaves streamed answers intact", async () => {
  const pending = deferred<unknown>();
  net.responses["threads.send"] = () => pending.promise;
  const hook = await mount();
  let sending: Promise<void> | undefined;
  await act(async () => {
    sending = hook.result.current.send("Review");
  });
  await act(async () => {
    net.sockets[0]?.event({ type: "message.created", message: message("msg_answer", 1, "Already working") });
    pending.reject(new Error("Send failed"));
    await expect(sending).rejects.toThrow("Send failed");
  });
  expect(hook.result.current.messages).toEqual([message("msg_answer", 1, "Already working")]);
  expect(hook.result.current.error).toBe("Send failed");
  await hook.unmount();
});

test("two concurrent sends with identical text retain both messages until their own acknowledgements arrive", async () => {
  const first = deferred<{ message: Message }>();
  const second = deferred<{ message: Message }>();
  let count = 0;
  net.responses["threads.send"] = () => (++count === 1 ? first.promise : second.promise);
  const hook = await mount();
  let one: Promise<void> | undefined;
  let two: Promise<void> | undefined;
  await act(async () => {
    one = hook.result.current.send("Again");
    two = hook.result.current.send("Again");
  });
  expect(hook.result.current.messages).toHaveLength(2);
  await act(async () => {
    first.resolve({ message: message("msg_one", 1, "Again", "user") });
    await one;
  });
  expect(hook.result.current.messages).toHaveLength(2);
  expect(hook.result.current.messages.filter((item) => item.id.startsWith("local_"))).toHaveLength(1);
  await act(async () => {
    net.sockets[0]?.event({ type: "message.created", message: message("msg_two", 2, "Again", "user") });
    second.resolve({ message: message("msg_two", 2, "Again", "user") });
    await two;
  });
  expect(hook.result.current.messages.map((item) => item.id)).toEqual(["msg_one", "msg_two"]);
  await hook.unmount();
});

test("working chats steer the current turn and stopping twice sends only one cancellation", async () => {
  net.responses["threads.get"] = { ...snapshot(), thread: { ...thread, state: "working" } };
  net.responses["threads.send"] = { message: message("msg_one", 1, "Steer", "user") };
  const cancellation = deferred<unknown>();
  net.responses["threads.cancel"] = () => cancellation.promise;
  const hook = await mount();
  await act(() => hook.result.current.send("Steer"));
  expect(net.calls).toContainEqual({
    method: "threads.send",
    params: { thread: thread.id, text: "Steer", mode: "steer" },
  });
  let stopping: Promise<void> | undefined;
  await act(async () => {
    stopping = hook.result.current.stop();
  });
  expect(hook.result.current.stopping).toBe(true);
  await act(() => hook.result.current.stop());
  expect(net.calls.filter((call) => call.method === "threads.cancel")).toHaveLength(1);
  await act(async () => {
    cancellation.resolve({ cancelled: true });
    await stopping;
  });
  expect(hook.result.current.stopping).toBe(false);
  await hook.unmount();
});

test("input responses reload the thread and model choices update the thread's override", async () => {
  net.responses["runs.respond"] = { accepted: true };
  net.responses["threads.model"] = { model_choice: { router: false, model: "provider/model" } };
  const hook = await mount();
  await act(() => hook.result.current.respond("inp_one", { decision: "approve", scope: "once" }));
  expect(net.calls).toContainEqual({
    method: "runs.respond",
    params: { input: "inp_one", decision: "approve", scope: "once" },
  });
  await act(() => hook.result.current.setModel({ router: false, model: "provider/model" }));
  expect(hook.result.current.thread?.model_choice).toEqual({ router: false, model: "provider/model" });
  net.responses["threads.model"] = { model_choice: undefined };
  await act(() => hook.result.current.setModel(null));
  expect(hook.result.current.thread?.model_choice).toBeUndefined();
  await hook.unmount();
});

test("a revoked device key unpairs once and stops reconnecting", async () => {
  net.faults["threads.get"] = { code: "unauthorized", message: "Device revoked" };
  const hook = await mount();
  expect(unpair).toHaveBeenCalledTimes(1);
  expect(hook.result.current.online).toBe(false);
  expect(net.sockets[0]?.readyState).toBe(3);
  await act(() => jest.advanceTimersByTimeAsync(60000));
  expect(net.sockets).toHaveLength(1);
  await hook.unmount();
});
