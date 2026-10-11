import assert from "node:assert/strict";
import { test } from "node:test";
import { starterModel } from "./starter.ts";

const chat = (...ids: string[]) => ids.map((id) => ({ id, chat: !/embed/.test(id) }));

test("a provider starts the chain with its newest everyday chat model, not a preview, snapshot or tiny one", () => {
  assert.equal(
    starterModel(
      chat(
        "gemini-2.5-pro",
        "gemini-2.0-flash-001",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-3-flash-preview",
        "gemini-embedding-001",
      ),
    ),
    "gemini-2.5-flash",
  );
  assert.equal(
    starterModel(
      chat("gpt-4o", "gpt-4o-mini-2024-07-18", "gpt-4.1-mini", "gpt-5-mini", "gpt-5-nano", "gpt-5.1-codex-mini"),
    ),
    "gpt-5-mini",
  );
  // Every id dated (Anthropic's list): the newest light one still wins.
  assert.equal(
    starterModel(chat("claude-opus-4-1-20250805", "claude-3-5-haiku-20241022", "claude-haiku-4-5-20251001")),
    "claude-haiku-4-5-20251001",
  );
  // No light tier: the newest of the rest.
  assert.equal(starterModel(chat("llama-3.1-70b", "llama-3.3-70b")), "llama-3.3-70b");
  assert.equal(starterModel(chat("fake-1")), "fake-1");
  assert.equal(starterModel(chat("text-embedding-3-small")), undefined);
});
