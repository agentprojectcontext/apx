import assert from "node:assert/strict";
import { test } from "node:test";
import { ImageDefaults, NEGATIVE_PROMPT_MAX } from "@apx/protocol";
import { mediaTools } from "./media.ts";

test("a negative prompt the owner may save as a default is one make_image takes", () => {
  const longest = "blurry, ".repeat(NEGATIVE_PROMPT_MAX).slice(0, NEGATIVE_PROMPT_MAX);
  const saved = ImageDefaults.parse({
    width: 1024,
    height: 1024,
    steps: 30,
    cfg_scale: 7,
    negative_prompt: longest,
    count: 1,
  });
  const make = mediaTools({} as never, "").find((t) => t.name === "make_image");
  const parsed = make?.parse({ prompt: "a lighthouse at dawn", negative_prompt: saved.negative_prompt });
  assert.equal(parsed?.ok, true);
});
