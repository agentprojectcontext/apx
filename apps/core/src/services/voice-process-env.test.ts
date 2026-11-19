import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceProcessEnv } from "./voice-process-env.ts";

test("voice subprocesses preserve Windows variable casing, system and cache settings but not provider credentials", () => {
  const system = {
    Path: "programs",
    SystemRoot: "system",
    USERPROFILE: "profile",
    LOCALAPPDATA: "cache",
    TEMP: "scratch",
    HTTPS_PROXY: "proxy",
    HF_HOME: "models",
    UV_CACHE_DIR: "packages",
    LC_ALL: "en_US.UTF-8",
  };
  assert.deepEqual(
    voiceProcessEnv({
      ...system,
      OPENAI_API_KEY: "unrelated",
      GEMINI_API_KEY: "unrelated",
      APX_TOKEN: "unrelated",
      HF_TOKEN: "unrelated",
      HF_API_KEY: "unrelated",
      UV_INDEX_PASSWORD: "unrelated",
      VOICE_SECRET: "unrelated",
    }),
    system,
  );
});
