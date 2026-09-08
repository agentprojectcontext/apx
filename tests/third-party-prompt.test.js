// The containment test for turns that answer someone who is NOT the owner.
//
// The rule this file defends: a third-party turn is assembled from an
// ALLOWLIST, so a block added to the owner prompt later cannot reach a stranger
// by default. The way to test an allowlist is not to check the parts you
// removed — it is to poison every input with a distinct sentinel and assert
// that none of them come out the other end. A new leak fails this test whether
// or not whoever wrote it knew this file existed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-thirdparty-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { buildSuperAgentSystem, buildThirdPartySystem, buildRelationshipBlock } =
  await import("#core/agent/prompt-builder.js");
const { CHANNELS } = await import("#core/constants/channels.js");

// One sentinel per input that a leak could travel through. The strings are
// nonsense on purpose: a substring match can't collide with prompt prose.
const SECRETS = {
  memory:        "ZZMEMORYZZ-el-cliente-paga-el-12",
  activeThreads: "ZZTHREADZZ-lo-que-dije-en-telegram",
  contextNote:   "ZZNOTEZZ-inyectado-por-el-daemon",
  instructions:  "ZZINSTRUCTIONSZZ-mis-reglas-privadas",
  projectName:   "ZZPROJECTZZ-crm-del-estudio",
  projectPath:   "/ZZPATHZZ/proyectos/secreto",
  lazyTools:     "ZZTOOLZZ_transferir_plata",
  suffix:        "ZZSUFFIXZZ-formato-interno",
  ownerName:     "ZZOWNERZZ-Manuel",
};

const projects = {
  list: () => [
    { id: 0, name: "default", path: "/tmp/default" },
    { id: 7, name: SECRETS.projectName, path: SECRETS.projectPath, kind: "client" },
  ],
};

const globalConfig = {
  user: { language: "es", locale: "es-AR", timezone: "America/Argentina/Buenos_Aires" },
  super_agent: {
    enabled: true,
    model: "test:model",
    name: "Roby",
    instructions: SECRETS.instructions,
  },
};

const poisonedInputs = {
  globalConfig,
  projects,
  listSkills: () => [{ slug: "siete-app", description: "los 7 negocios" }],
  contextNote: SECRETS.contextNote,
  channelMeta: { projectId: 7, projectName: SECRETS.projectName, projectPath: SECRETS.projectPath },
  systemSuffix: SECRETS.suffix,
  memoryBlock: `[MEMORIA RELEVANTE]\n${SECRETS.memory}`,
  activeThreadsBlock: `# Active threads on other channels\n- telegram · 12 min ago: ${SECRETS.activeThreads}`,
  lazyToolsBlock: `# Tools you can activate\n${SECRETS.lazyTools}`,
};

const guest = { userId: "5491100000000@s.whatsapp.net", name: "Carla", role: "contact", isOwner: false };

test("the owner prompt really does carry every secret (the test's own premise)", () => {
  const system = buildSuperAgentSystem({ ...poisonedInputs, channel: CHANNELS.WHATSAPP });
  for (const [label, secret] of Object.entries(SECRETS)) {
    if (label === "ownerName") continue; // not an input to this builder
    assert.ok(
      system.includes(secret),
      `owner prompt should contain ${label} — if it no longer does, this test is checking nothing`
    );
  }
});

test("a third-party turn leaks none of them", () => {
  const system = buildSuperAgentSystem({
    ...poisonedInputs,
    channel: CHANNELS.WHATSAPP,
    audience: "third_party",
    relationshipBlock: buildRelationshipBlock(guest, { platform: "WhatsApp" }),
  });

  for (const [label, secret] of Object.entries(SECRETS)) {
    assert.ok(
      !system.includes(secret),
      `third-party prompt LEAKED ${label} (${secret}).\n` +
      `Prompt was:\n${system}`
    );
  }
});

test("the third-party prompt still says who it is talking to", () => {
  const system = buildSuperAgentSystem({
    ...poisonedInputs,
    channel: CHANNELS.WHATSAPP,
    audience: "third_party",
    relationshipBlock: buildRelationshipBlock(guest, { platform: "WhatsApp" }),
  });
  assert.match(system, /Carla/, "the contact's name is the one identity it does need");
  assert.match(system, /never leave anyone in silence/i, "the no-visto rule must survive");
  assert.match(system, /whatsapp/i, "the channel block must be present");
});

test("a channel with no third-party prompt refuses instead of falling back", () => {
  // Falling back to the owner-facing file is exactly the failure mode this
  // guards: telegram.md is written for the owner and would be handed to a
  // stranger by a channel that merely forgot to configure itself.
  assert.throws(
    () => buildThirdPartySystem({ globalConfig, channel: CHANNELS.TELEGRAM }),
    /no third-party prompt/,
    "an unconfigured channel must not be able to answer a non-owner"
  );
});

test("audience defaults to owner, so existing callers are untouched", () => {
  const withDefault = buildSuperAgentSystem({ ...poisonedInputs, channel: CHANNELS.WEB });
  const explicit = buildSuperAgentSystem({ ...poisonedInputs, channel: CHANNELS.WEB, audience: "owner" });
  assert.equal(withDefault, explicit);
  assert.ok(withDefault.includes(SECRETS.memory));
});
