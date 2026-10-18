import { act, renderHook } from "@testing-library/react-native";
import { NoticePrefs } from "../../../packages/protocol/src/index.ts";
import { type Notice, type Routine, type Task, type Thread, useWorkspace } from "../src/hooks/useWorkspace";
import { credentials, transport } from "./transport.test-support";

let net: ReturnType<typeof transport>;
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
  net = transport();
});
afterEach(() => {
  net.restore();
  jest.useRealTimers();
});

const thread: Thread = {
  id: "thr_one",
  kind: "loose",
  title: "Work",
  agent_ids: ["april"],
  state: "idle",
  preview: "Before",
  unread: 0,
  updated_at: "2026-10-18T10:00:00Z",
};
const task: Task = {
  id: "tsk_one",
  title: "Review",
  kind: "task",
  status: "todo",
  state: "open",
  priority: "normal",
  thread_id: "thr_task",
  awaits_owner: false,
  activity_at: "2026-10-18T10:00:00Z",
};
const routine: Routine = {
  id: "rtn_one",
  name: "Review",
  enabled: true,
  agent_id: "april",
  schedule: { kind: "every", minutes: 60 },
  action: "agent",
  prompt: "Check changes",
  call_model: "always",
  anchor: false,
};
const mount = () => renderHook(() => useWorkspace(credentials));

test("workspace loads primary and secondary data, including supported native sessions", async () => {
  net.responses["threads.list"] = { threads: [thread] };
  net.responses["projects.list"] = { projects: [{ id: "p_one", name: "Acme" }] };
  net.responses["engines.status"] = {
    engines: [
      { id: "claude", installed: true },
      { id: "codex", installed: false },
      { id: "other", installed: true },
    ],
  };
  net.responses["sessions.native"] = { sessions: [{ id: "native_1", title: "Session" }] };
  net.responses["memory.settings"] = { total: 7 };
  const hook = await mount();
  expect(hook.result.current.loading).toBe(false);
  expect(hook.result.current.online).toBe(true);
  expect(hook.result.current.error).toBe("");
  expect(hook.result.current.data).toEqual(
    expect.objectContaining({
      threads: [thread],
      projects: [{ id: "p_one", name: "Acme" }],
      sessions: { claude: [{ id: "native_1", title: "Session" }] },
      owner: "Alex",
      memories: 7,
    }),
  );
  expect(
    net.calls.filter((call) => call.method === "sessions.native").every((call) => call.params.engine === "claude"),
  ).toBe(true);
  expect(net.calls.some((call) => call.method === "sessions.native")).toBe(true);
  await hook.unmount();
  expect(net.sockets[0]?.readyState).toBe(3);
});

test("secondary failures keep the previous data while primary failures stop loading and expose the error", async () => {
  net.responses["projects.list"] = { projects: [{ id: "p_one", name: "Acme" }] };
  const hook = await mount();
  net.responses["projects.list"] = new Error("Projects unavailable");
  net.responses["threads.list"] = new Error("Core unavailable");
  await act(() => hook.result.current.refresh());
  expect(hook.result.current.data.projects).toEqual([{ id: "p_one", name: "Acme" }]);
  expect(hook.result.current.online).toBe(false);
  expect(hook.result.current.loading).toBe(false);
  expect(hook.result.current.error).toBe("Core unavailable");
  await hook.unmount();
});

test("live thread and message events update previews, remove children and ignore another stream", async () => {
  net.responses["threads.list"] = { threads: [thread, { ...thread, id: "thr_child" }] };
  const hook = await mount();
  const socket = net.sockets[0];
  expect(socket).toBeDefined();
  await act(async () => {
    socket?.event({ type: "thread.updated", thread: { ...thread, title: "Wrong" } }, "other");
    socket?.event({ type: "thread.updated", thread: { ...thread, title: "Changed" } });
    socket?.event({
      type: "message.updated",
      message: {
        thread_id: thread.id,
        created_at: "2026-10-18T11:00:00Z",
        parts: [
          { type: "text", text: "Latest" },
          { type: "notice", text: "Hidden" },
          { type: "text", text: "answer" },
        ],
      },
    });
  });
  expect(hook.result.current.data.threads.find((item) => item.id === thread.id)).toEqual({
    ...thread,
    title: "Changed",
    preview: "Latest answer",
    updated_at: "2026-10-18T11:00:00Z",
  });
  await act(async () => socket?.event({ type: "thread.deleted", thread_id: thread.id, children: ["thr_child"] }));
  expect(hook.result.current.data.threads).toEqual([]);
  await hook.unmount();
});

test("socket closure reconnects after one second and unmount cancels further reconnects", async () => {
  const hook = await mount();
  expect(net.sockets).toHaveLength(1);
  await act(async () => net.sockets[0]?.close());
  expect(hook.result.current.online).toBe(false);
  await act(() => jest.advanceTimersByTimeAsync(999));
  expect(net.sockets).toHaveLength(1);
  await act(() => jest.advanceTimersByTimeAsync(1));
  expect(net.sockets).toHaveLength(2);
  expect(hook.result.current.online).toBe(true);
  await hook.unmount();
  await act(() => jest.advanceTimersByTimeAsync(60000));
  expect(net.sockets).toHaveLength(2);
  expect(net.sockets.every((socket) => socket.readyState === 3)).toBe(true);
});

test("a socket whose welcome arrives after unmount is closed without refreshing data", async () => {
  net.restore();
  net = transport({ holdWelcome: true });
  const hook = await mount();
  expect(net.sockets).toHaveLength(1);
  await hook.unmount();
  const count = net.calls.length;
  await act(async () => net.sockets[0]?.welcome());
  expect(net.sockets[0]?.readyState).toBe(3);
  expect(net.calls).toHaveLength(count);
});

test("opening a thread continues when read acknowledgement fails and answering an input refreshes workspace data", async () => {
  net.responses["threads.read"] = new Error("Read acknowledgement failed");
  net.responses["threads.get"] = { thread, messages: [], runs: [] };
  net.responses["runs.respond"] = { accepted: true };
  const hook = await mount();
  net.calls.length = 0;
  expect(await hook.result.current.openThread(thread.id)).toEqual({ thread, messages: [], runs: [] });
  expect(net.calls.slice(0, 2)).toEqual([
    { method: "threads.read", params: { thread: thread.id } },
    { method: "threads.get", params: { thread: thread.id } },
  ]);
  await act(() => hook.result.current.respond("inp_one", { decision: "approve", scope: "once" }));
  expect(net.calls).toContainEqual({
    method: "runs.respond",
    params: { input: "inp_one", decision: "approve", scope: "once" },
  });
  await hook.unmount();
});

test("reading the same notice twice decrements unread only once and preserves other unread notices", async () => {
  const notice: Notice = {
    id: "ntf_one",
    kind: "task",
    title: "Review",
    level: "info",
    body: "",
    created_at: "2026-10-18T10:00:00Z",
  };
  net.responses["notifications.list"] = { notifications: [notice, { ...notice, id: "ntf_two" }], unread: 2 };
  net.responses["notifications.read"] = { ok: true };
  const hook = await mount();
  await act(() => hook.result.current.readNotice(notice));
  await act(() => hook.result.current.readNotice(notice));
  expect(hook.result.current.data.unread).toBe(1);
  expect(hook.result.current.data.notices.find((item) => item.id === notice.id)?.read_at).toEqual(expect.any(String));
  expect(hook.result.current.data.notices.find((item) => item.id === "ntf_two")?.read_at).toBeUndefined();
  await hook.unmount();
});

test("saving, toggling, running and listing routine runs preserve commands and send the routine id", async () => {
  net.responses["routines.list"] = { routines: [routine] };
  net.responses["routines.set"] = routine;
  net.responses["routines.run"] = { thread_id: "thr_run" };
  net.responses["routines.runs"] = { runs: [{ run_id: "run_one" }] };
  const hook = await mount();
  await act(() => hook.result.current.saveRoutine(routine, { prompt: "Read reports" }));
  expect(net.calls).toContainEqual({
    method: "routines.set",
    params: {
      id: routine.id,
      name: routine.name,
      agent: routine.agent_id,
      schedule: routine.schedule,
      action: routine.action,
      prompt: "Read reports",
      pre_command: "",
      post_command: "",
      call_model: "always",
      anchor: false,
      enabled: true,
    },
  });
  await act(() => hook.result.current.toggleRoutine(routine, false));
  expect(net.calls.filter((call) => call.method === "routines.set").at(-1)?.params.enabled).toBe(false);
  await act(() => hook.result.current.runRoutine(routine.id));
  expect(net.calls).toContainEqual({ method: "routines.run", params: { routine: routine.id } });
  expect(await hook.result.current.routineRuns(routine.id, 8)).toEqual([{ run_id: "run_one" }]);
  expect(net.calls.at(-1)).toEqual({ method: "routines.runs", params: { routine: routine.id, limit: 8 } });
  await hook.unmount();
});

test("creating, updating, commenting and deleting a task update local state only after successful calls", async () => {
  net.responses["tasks.create"] = task;
  net.responses["tasks.update"] = { ...task, title: "Updated" };
  net.responses["tasks.comment"] = { ok: true };
  net.responses["tasks.delete"] = { removed: true };
  const hook = await mount();
  await act(() => hook.result.current.createTask({ title: "Review", project: "p_one" }));
  expect(hook.result.current.data.tasks).toEqual([task]);
  await act(() => hook.result.current.updateTask(task.id, { title: "Updated" }));
  expect(hook.result.current.data.tasks).toEqual([{ ...task, title: "Updated" }]);
  await hook.result.current.commentTask(task.id, "@april Please review");
  expect(net.calls.at(-1)).toEqual({
    method: "tasks.comment",
    params: { task: task.id, text: "@april Please review" },
  });
  net.responses["tasks.delete"] = new Error("Delete refused");
  await act(async () => {
    await expect(hook.result.current.deleteTask(task.id)).rejects.toThrow("Delete refused");
  });
  expect(hook.result.current.data.tasks).toHaveLength(1);
  net.responses["tasks.delete"] = { removed: true };
  await act(() => hook.result.current.deleteTask(task.id));
  expect(hook.result.current.data.tasks).toEqual([]);
  await hook.unmount();
});

test("task detail combines comments and teammate sessions in order and survives an unavailable conversation", async () => {
  const session = { ...thread, id: "thr_session", updated_at: "2026-10-18T12:00:00Z" };
  const consult = { ...thread, id: "thr_consult", updated_at: "2026-10-18T11:00:00Z" };
  const usage = [{ model: "provider/model", runs: 1, input: 12, output: 4 }];
  net.responses["tasks.get"] = { task, events: [{ id: "event_1" }], sessions: [session], consults: [consult], usage };
  net.responses["threads.get"] = {
    messages: [
      {
        id: "msg_comment",
        author: { kind: "user" },
        parts: [{ type: "text", text: "Please review" }],
        created_at: "2026-10-18T10:00:00Z",
      },
    ],
  };
  const hook = await mount();
  await act(async () => {
    expect(await hook.result.current.taskDetail(task.id)).toEqual({
      events: [{ id: "event_1" }],
      comments: [{ id: "msg_comment", by: "owner", text: "Please review", at: "2026-10-18T10:00:00Z" }],
      sessions: [consult, session],
      usage,
    });
  });
  expect(hook.result.current.data.tasks).toEqual([task]);
  net.responses["threads.get"] = new Error("Conversation unavailable");
  await act(async () => {
    expect((await hook.result.current.taskDetail(task.id)).comments).toEqual([]);
  });
  await hook.unmount();
});

test("closing ordinary tasks and settling commitments keep their different outcomes", async () => {
  net.responses["tasks.close"] = task;
  net.responses["tasks.settle"] = { ...task, kind: "commitment" };
  const hook = await mount();
  for (const [kind, state, method, field, value] of [
    ["task", "done", "tasks.close", "state", "done"],
    ["task", "missed", "tasks.close", "state", "dropped"],
    ["commitment", "done", "tasks.settle", "outcome", "kept"],
    ["commitment", "missed", "tasks.settle", "outcome", "missed"],
    ["commitment", "dropped", "tasks.settle", "outcome", "dropped"],
    ["commitment", "open", "tasks.close", "state", "open"],
  ] as const) {
    await act(() => hook.result.current.closeTask({ ...task, kind }, state));
    expect(net.calls.at(-1)).toEqual({ method, params: { task: task.id, [field]: value } });
    expect(hook.result.current.data.tasks).toHaveLength(1);
  }
  await hook.unmount();
});

test("memory actions keep global and project scopes distinct and update the counter after success", async () => {
  net.responses["memory.list"] = { memories: [{ id: "mem_one", text: "Use TypeScript" }] };
  net.responses["memory.add"] = { id: "mem_two", text: "Review" };
  net.responses["memory.remove"] = { removed: true };
  const hook = await mount();
  expect(await hook.result.current.memories({ query: "TypeScript", project: "p_one" })).toEqual([
    { id: "mem_one", text: "Use TypeScript" },
  ]);
  expect(net.calls.at(-1)).toEqual({
    method: "memory.list",
    params: { limit: 100, query: "TypeScript", project: "p_one" },
  });
  await act(() => hook.result.current.addMemory("Review"));
  expect(net.calls.at(-1)).toEqual({ method: "memory.add", params: { text: "Review", scope: "global" } });
  await act(() => hook.result.current.addMemory("Project review", "p_one"));
  expect(net.calls.at(-1)).toEqual({
    method: "memory.add",
    params: { text: "Project review", scope: "project", project: "p_one" },
  });
  expect(hook.result.current.data.memories).toBe(2);
  await act(() => hook.result.current.removeMemory("mem_two"));
  expect(hook.result.current.data.memories).toBe(1);
  await hook.unmount();
});

test("file and server actions preserve project paths and tolerate an unavailable device list", async () => {
  net.responses["files.tree"] = { entries: [], truncated: false };
  net.responses["files.read"] = { path: "notes.md", bytes: 4, binary: false, truncated: false, text: "note" };
  net.responses["files.media"] = { mime: "image/png", data: "dGVzdA==", bytes: 4 };
  net.responses["system.health"] = { version: "2.0.0", code_sha: "test", subsystems: {} };
  net.responses["devices.list"] = new Error("Devices unavailable");
  const hook = await mount();
  expect(await hook.result.current.fileTree("p_one", "docs")).toEqual({ entries: [], truncated: false });
  expect(net.calls.at(-1)).toEqual({ method: "files.tree", params: { project: "p_one", dir: "docs" } });
  expect((await hook.result.current.readFile("p_one", "notes.md")).text).toBe("note");
  expect(net.calls.at(-1)).toEqual({ method: "files.read", params: { project: "p_one", path: "notes.md" } });
  expect((await hook.result.current.fileMedia("p_one", "photo.png")).mime).toBe("image/png");
  expect(net.calls.at(-1)).toEqual({ method: "files.media", params: { project: "p_one", path: "photo.png" } });
  expect(await hook.result.current.serverInfo()).toEqual({
    health: net.responses["system.health"],
    devices: undefined,
  });
  await hook.unmount();
});

test("new chats and sessions preserve engine, project and agent identity and deduplicate resumed threads", async () => {
  net.responses["agents.list"] = { agents: [{ id: "april", kind: "secretary", name: "April" }] };
  net.responses["projects.list"] = { projects: [{ id: "p_one", name: "Acme", path: "/work/acme", registered: true }] };
  net.responses["threads.create"] = thread;
  net.responses["sessions.resume"] = thread;
  net.responses["projects.create"] = { project: { id: "p_two", name: "New" } };
  const hook = await mount();
  const pending = hook.result.current.newSession("claude", "p_one");
  expect(pending.title).toBe("Claude Code");
  await act(() => hook.result.current.makeChat(pending));
  expect(net.calls.at(-1)).toEqual({
    method: "threads.create",
    params: {
      kind: "code",
      agent_id: "april",
      project_id: "p_one",
      engine: "claude",
      title: "Claude Code",
    },
  });
  await act(() => hook.result.current.createChat("april", "p_one"));
  expect(net.calls.at(-1)).toEqual({
    method: "threads.create",
    params: { kind: "loose", agent_id: "april", project_id: "p_one" },
  });
  await act(() => hook.result.current.resumeSession("codex", "native_one"));
  expect(net.calls.at(-1)).toEqual({ method: "sessions.resume", params: { engine: "codex", id: "native_one" } });
  expect(hook.result.current.data.threads.filter((item) => item.id === thread.id)).toHaveLength(1);
  await act(() => hook.result.current.createProject({ name: "New" }));
  expect(hook.result.current.data.projects).toContainEqual({ id: "p_two", name: "New" });
  expect(() => hook.result.current.newSession("claude", "missing")).toThrow();
  await expect(hook.result.current.makeChat(thread)).rejects.toThrow("not a new chat");
  await hook.unmount();
});

test("notice preferences round-trip unchanged through the protocol boundary", async () => {
  const prefs = NoticePrefs.parse({
    channel: "telegram-main",
    quiet_from: "22:00",
    quiet_to: "08:00",
    budget_per_day: 4,
  });
  net.responses["notices.get"] = prefs;
  net.responses["notices.set"] = prefs;
  const hook = await mount();
  expect(await hook.result.current.noticePrefs()).toEqual(prefs);
  expect(await hook.result.current.setNoticePrefs(prefs)).toEqual(prefs);
  expect(net.calls.at(-1)).toEqual({ method: "notices.set", params: prefs });
  await hook.unmount();
});
