import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_SLIDES, seenBefore, slidesToShow, WELCOME_SLIDES } from "./welcomeFilm.ts";

const keys = (version: string, seen: readonly string[]) => slidesToShow(version, seen).map((s) => s.key);

test("a device that saw every slide but a new one is shown only the new one", () => {
  const fresh = WELCOME_SLIDES[0].key;
  assert.deepEqual(
    keys(
      "2.14.4",
      ALL_SLIDES.filter((k) => k !== fresh),
    ),
    [fresh],
  );
  assert.deepEqual(keys("2.14.4", ALL_SLIDES), []);
});

test("a slide stops showing two minor releases after the one it shipped in", () => {
  const since = (v: string): string[] => WELCOME_SLIDES.filter((s) => s.since.startsWith(v)).map((s) => s.key);
  assert.deepEqual(keys("2.15.3", []), [...ALL_SLIDES]);
  assert.deepEqual(
    keys("2.16.0", []),
    ALL_SLIDES.filter((k) => !since("2.14.").includes(k)),
  );
  assert.deepEqual(keys("3.0.0", []), []);
});

test("a build that is not a release shows every slide not seen", () => {
  assert.deepEqual(keys("0.0.0", []), [...ALL_SLIDES]);
  assert.deepEqual(keys("2.14.3-dev.4+abc1234", ["groups"]), ALL_SLIDES.slice(1));
});

test("a device that closed the single-film welcome of 2.14.3 is shown only what came after it", () => {
  const after = WELCOME_SLIDES.filter((s) => s.since !== "2.14.0").map((s) => s.key);
  assert.deepEqual(keys("2.14.4", seenBefore("whats-new-2.14.3")), after);
  assert.deepEqual(seenBefore("whats-new-2.14"), []);
  assert.deepEqual(seenBefore(true), []);
});
