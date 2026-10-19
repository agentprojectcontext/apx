import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopSessionEnv } from "./session.ts";

test("a user service borrows only graphical settings, never another APX target or credentials", () => {
  const env = desktopSessionEnv(
    "linux",
    { APX_HOME: "/selected" },
    () => "DISPLAY=:1\nWAYLAND_DISPLAY=wayland-0\nXDG_RUNTIME_DIR=/run/user/1000\nAPX_HOME=/other\nAPX_TOKEN=outside\n",
  );
  assert.equal(env.DISPLAY, ":1");
  assert.equal(env.WAYLAND_DISPLAY, "wayland-0");
  assert.equal(env.APX_HOME, "/selected");
  assert.equal(env.APX_TOKEN, undefined);
});

test("headless manager failure keeps desktop unavailable; SSH is never upgraded to graphical", () => {
  assert.deepEqual(
    desktopSessionEnv("linux", {}, () => {
      throw new Error("no user bus");
    }),
    {},
  );
  let reads = 0;
  const env = { SSH_CONNECTION: "remote" };
  assert.equal(
    desktopSessionEnv("linux", env, () => {
      reads++;
      return "DISPLAY=:1";
    }),
    env,
  );
  assert.equal(reads, 0);
});
