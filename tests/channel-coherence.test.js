// Cross-channel coherence: every surface layers the SAME super-agent identity
// but adds its OWN channel context block, and voice mode applies only where
// asked. Guards against a channel silently losing the identity/role or two
// channels collapsing to the same prompt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSuperAgentSystem } from "#core/agent/prompt-builder.js";
import { CHANNELS } from "#core/constants/channels.js";

const cfg = {
  super_agent: { enabled: true, name: "apx", model: "gemini:gemini-2.0-flash" },
  user: { language: "es", locale: "es-AR" },
};
const listSkills = () => [];

function build(channel, channelMeta = {}) {
  return buildSuperAgentSystem({ globalConfig: cfg, projects: [], listSkills, channel, channelMeta });
}

const SURFACES = [
  CHANNELS.CLI, CHANNELS.TELEGRAM, CHANNELS.DESKTOP,
  CHANNELS.WEB_SIDEBAR, CHANNELS.WEB, CHANNELS.DECK, CHANNELS.CODE,
];

test("the super-agent role is present on every channel", () => {
  // Assert against the always-present base ROLE (agent-base.md), not the
  // identity — identity comes from ~/.apx/identity.json, which is absent in CI.
  for (const ch of SURFACES) {
    const sys = build(ch, ch === CHANNELS.DESKTOP ? { voice: true } : {});
    assert.match(sys, /tool-using action agent|USE TOOLS/i, `base role missing on channel "${ch}"`);
    assert.ok(sys.length > 500, `channel "${ch}" prompt suspiciously short`);
  }
});

test("each channel produces a distinct system prompt (own context block)", () => {
  const seen = new Map();
  for (const ch of SURFACES) {
    const sys = build(ch, ch === CHANNELS.DESKTOP ? { voice: true } : {});
    for (const [other, otherSys] of seen) {
      assert.notEqual(sys, otherSys, `channels "${ch}" and "${other}" produced identical prompts`);
    }
    seen.set(ch, sys);
  }
});

test("voice mode layers extra content on desktop but not on text channels", () => {
  const cli = build(CHANNELS.CLI, {});
  const desktopVoice = build(CHANNELS.DESKTOP, { voice: true });
  const desktopNoVoice = build(CHANNELS.DESKTOP, {});
  // voice:true adds the voice-mode block → strictly longer than no-voice desktop.
  assert.ok(desktopVoice.length > desktopNoVoice.length, "voice mode should add content");
  // and a text channel never carries the voice block
  assert.ok(desktopVoice.length > cli.length);
});

test("unknown channel still builds (no channel block, no crash)", () => {
  const sys = build("totally-unknown-surface", {});
  assert.match(sys, /tool-using action agent|USE TOOLS/i);
});
