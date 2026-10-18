import assert from "node:assert/strict";
import { test } from "node:test";
import { notifications } from "./notifications.ts";
import { printed, recordingClient } from "./testing.ts";

test("notifications show unread markers, kind labels, flattened bodies and chat destinations", async () => {
  const { client, calls } = recordingClient({
    "notifications.list": {
      unread: 1,
      notifications: [
        {
          kind: "input",
          title: "Allow command",
          body: "First\nSecond",
          thread_id: "thr_1",
          created_at: "2026-01-01T12:00:00Z",
          read_at: null,
        },
        {
          kind: "custom",
          title: "Read notice",
          body: "",
          created_at: "2026-01-01T12:00:00Z",
          read_at: "2026-01-01T13:00:00Z",
        },
      ],
    },
  });
  const out = await printed(() => notifications(client, []));
  assert.match(out, /^• .*needs your OK · Allow command — First Second {2}\[thr_1\]/);
  assert.match(out, /\n .*custom · Read notice\n\n1 unread$/);
  assert.deepEqual(calls, [["notifications.list", {}]]);
});

test("empty notifications and marking all read use their own protocol methods", async () => {
  const { client, calls } = recordingClient({
    "notifications.list": { notifications: [], unread: 0 },
    "notifications.read": { unread: 0 },
  });
  assert.equal(await printed(() => notifications(client, [])), "(nothing for you)");
  assert.equal(await printed(() => notifications(client, ["read"])), "0 unread");
  assert.deepEqual(calls, [
    ["notifications.list", {}],
    ["notifications.read", {}],
  ]);
});

test("unknown notification commands have no effect; protocol failures remain failures", async () => {
  const error = new Error("core unavailable");
  const { client, calls } = recordingClient({ "notifications.read": error });
  await assert.rejects(notifications(client, ["delete"]), /usage: apx notifications/);
  assert.deepEqual(calls, []);
  await assert.rejects(notifications(client, ["read"]), (e) => e === error);
});
