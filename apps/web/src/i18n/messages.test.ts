import assert from "node:assert/strict";
import { test } from "node:test";
import { enActivityReview } from "./activity-review-en.ts";
import { esActivityReview } from "./activity-review-es.ts";
import { enApprovals } from "./approvals-en.ts";
import { esApprovals } from "./approvals-es.ts";
import { enComputer } from "./computer-en.ts";
import { esComputer } from "./computer-es.ts";
import { en as base } from "./en.ts";
import { enEmailSignatures } from "./en-email-signatures.ts";
import { enResources } from "./en-resources.ts";
import { enSetup } from "./en-setup.ts";
import { enTeam } from "./en-team.ts";
import { es as esBase } from "./es.ts";
import { esEmailSignatures } from "./es-email-signatures.ts";
import { esResources } from "./es-resources.ts";
import { esSetup } from "./es-setup.ts";
import { esTeam } from "./es-team.ts";
import { enFlow } from "./flow-en.ts";
import { esFlow } from "./flow-es.ts";
import { enIngress } from "./ingress-en.ts";
import { esIngress } from "./ingress-es.ts";
import { enReceived } from "./received-en.ts";
import { esReceived } from "./received-es.ts";
import { enSecretary } from "./secretary-en.ts";
import { esSecretary } from "./secretary-es.ts";
import { enSignIn } from "./signin-en.ts";
import { esSignIn } from "./signin-es.ts";
import { enStorage } from "./storage-en.ts";
import { esStorage } from "./storage-es.ts";
import { enSysUsage } from "./sysusage-en.ts";
import { esSysUsage } from "./sysusage-es.ts";
import { enThreadDialogs } from "./thread-dialogs-en.ts";
import { esThreadDialogs } from "./thread-dialogs-es.ts";

test("the setup screens' strings load with them, never with the first screen", async () => {
  const { loadMessages, loadPack } = await import("./messages.ts");
  for (const lang of ["en", "es"] as const) {
    const messages = await loadMessages(lang);
    // What other screens show from setup stays in the language itself.
    assert.equal(messages["setup.project.pick"], lang === "en" ? "Choose folder" : "Elegir carpeta");
    for (const key of Object.keys(enSetup) as (keyof typeof enSetup)[]) assert.equal(messages[key], undefined);
    assert.deepEqual(await loadPack("setup", lang), lang === "en" ? enSetup : esSetup);
  }
});

test("the team pack's strings load with its screens, never with the first screen", async () => {
  const { loadMessages, loadPack } = await import("./messages.ts");
  for (const lang of ["en", "es"] as const) {
    const messages = await loadMessages(lang);
    assert.equal(messages["team.new.title"], lang === "en" ? "New agent" : "Nuevo agente");
    for (const key of Object.keys(enTeam) as (keyof typeof enTeam)[]) assert.equal(messages[key], undefined);
    assert.deepEqual(await loadPack("team", lang), lang === "en" ? enTeam : esTeam);
  }
});

test("the resources pack's strings load with its screens, never with the first screen", async () => {
  const { loadMessages, loadPack } = await import("./messages.ts");
  for (const lang of ["en", "es"] as const) {
    const messages = await loadMessages(lang);
    assert.equal(messages["res.tab.skills"], lang === "en" ? "Skills" : "Skills");
    for (const key of Object.keys(enResources) as (keyof typeof enResources)[]) assert.equal(messages[key], undefined);
    assert.deepEqual(await loadPack("resources", lang), lang === "en" ? enResources : esResources);
  }
});

test("activity review details stay off the first screen while its navigation remains translated", async () => {
  const { loadMessages, loadPack } = await import("./messages.ts");
  for (const lang of ["en", "es"] as const) {
    const messages = await loadMessages(lang);
    assert.equal(messages["config.activityReview"], lang === "en" ? "Activity review" : "Revisión y mejoras");
    for (const key of Object.keys(enActivityReview) as (keyof typeof enActivityReview)[]) {
      assert.equal(messages[key], undefined);
    }
    assert.deepEqual(await loadPack("activityReview", lang), lang === "en" ? enActivityReview : esActivityReview);
  }
});

test("approval details do not load with the first screen in either language", async () => {
  const { loadMessages, loadPack } = await import("./messages.ts");
  for (const lang of ["en", "es"] as const) {
    const messages = await loadMessages(lang);
    assert.equal(messages["input.browserSafety"], undefined);
    assert.equal(messages["input.confirmTitle"], undefined);
    assert.equal(messages["res.browserPermissionsHelp"], undefined);
    assert.equal(messages["input.sessionScope"], lang === "en" ? "This session" : "Esta sesión");
    for (const key of Object.keys(enApprovals) as (keyof typeof enApprovals)[]) {
      assert.equal(messages[key], undefined);
    }
    assert.deepEqual(await loadPack("approvals", lang), lang === "en" ? enApprovals : esApprovals);
  }
});

test("thread dialog strings load only with their pack in both languages", async () => {
  const { loadMessages, loadPack } = await import("./messages.ts");
  for (const lang of ["en", "es"] as const) {
    const base = await loadMessages(lang);
    const pack = await loadPack("threads", lang);
    for (const key of Object.keys(enThreadDialogs) as (keyof typeof enThreadDialogs)[]) {
      assert.equal(base[key], undefined);
    }
    assert.deepEqual(pack, lang === "en" ? enThreadDialogs : esThreadDialogs);
  }
});

test("Flow strings load only with their management screen in both languages", async () => {
  const { loadMessages, loadPack } = await import("./messages.ts");
  for (const lang of ["en", "es"] as const) {
    const base = await loadMessages(lang);
    const pack = await loadPack("flow", lang);
    for (const key of Object.keys(enFlow) as (keyof typeof enFlow)[]) assert.equal(base[key], undefined);
    assert.deepEqual(pack, lang === "en" ? enFlow : esFlow);
  }
});

test("public ingress strings load only with their configuration screen in both languages", async () => {
  const { loadMessages, loadPack } = await import("./messages.ts");
  for (const lang of ["en", "es"] as const) {
    const base = await loadMessages(lang);
    const pack = await loadPack("ingress", lang);
    assert.equal(base["hooks.title"], undefined);
    assert.equal(base["hooks.offBody"], undefined);
    assert.equal(pack["hooks.title"], lang === "en" ? "Public address" : "Dirección pública");
    for (const key of Object.keys(enIngress) as (keyof typeof enIngress)[]) assert.equal(base[key], undefined);
    assert.deepEqual(pack, lang === "en" ? enIngress : esIngress);
  }
});

test("public ingress request errors remain translated before its late pack arrives", async () => {
  const { loadMessages } = await import("./messages.ts");
  const en = await loadMessages("en");
  const es = await loadMessages("es");
  assert.equal(en["hooks.failed"], "The public address could not change: {error}");
  assert.equal(es["hooks.failed"], "No se pudo cambiar la dirección pública: {error}");
});

test("signature strings load as a separate pack in both languages", async () => {
  const { loadMessages, loadPack } = await import("./messages.ts");
  for (const lang of ["en", "es"] as const) {
    const base = await loadMessages(lang);
    const pack = await loadPack("signatures", lang);
    assert.equal(base["signature.saved"], undefined);
    assert.deepEqual(pack, lang === "en" ? enEmailSignatures : esEmailSignatures);
  }
});

test("secretary capability strings load only with the super-agent's settings in both languages", async () => {
  const { loadMessages, loadPack } = await import("./messages.ts");
  for (const lang of ["en", "es"] as const) {
    const base = await loadMessages(lang);
    const pack = await loadPack("secretary", lang);
    for (const key of Object.keys(enSecretary) as (keyof typeof enSecretary)[]) assert.equal(base[key], undefined);
    assert.deepEqual(pack, lang === "en" ? enSecretary : esSecretary);
  }
});

// A pack's strings belong to the language as much as the main chunk's.
const en = {
  ...base,
  ...enActivityReview,
  ...enApprovals,
  ...enComputer,
  ...enReceived,
  ...enSysUsage,
  ...enStorage,
  ...enSignIn,
  ...enEmailSignatures,
  ...enThreadDialogs,
  ...enIngress,
  ...enFlow,
  ...enSecretary,
  ...enSetup,
  ...enResources,
  ...enTeam,
};
const es = {
  ...esBase,
  ...esActivityReview,
  ...esApprovals,
  ...esComputer,
  ...esReceived,
  ...esSysUsage,
  ...esStorage,
  ...esSignIn,
  ...esEmailSignatures,
  ...esThreadDialogs,
  ...esIngress,
  ...esFlow,
  ...esSecretary,
  ...esSetup,
  ...esResources,
  ...esTeam,
};

// Each language is loaded alone, so a key it lacks would show as the bare key.
test("every English text has its Spanish translation", () => {
  const missing = Object.keys(en).filter((k) => (es as Record<string, string | undefined>)[k] === undefined);
  assert.deepEqual(missing, []);
});

// Loanwords are common elsewhere ("Chat", "Skills"); the model picker has none besides these names.
test("the model picker's Spanish texts are translated, not copied from English", () => {
  const tr = es as Record<string, string | undefined>;
  const words = (s: string) => s.replace(/\{\w+\}|Router|Ultra|[^A-Za-z]/g, "");
  const copied = Object.entries(en).filter(([k, v]) => k.startsWith("models.") && tr[k] === v && words(v));
  assert.deepEqual(
    copied.map(([k]) => k),
    [],
  );
});

test("a translation keeps the placeholders of its English text", () => {
  const tr = es as Record<string, string | undefined>;
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const wrong = Object.entries(en).filter(
    ([k, v]) => tr[k] !== undefined && vars(tr[k] ?? "").join() !== vars(v).join(),
  );
  assert.deepEqual(
    wrong.map(([k]) => k),
    [],
  );
});

test("the routine steps hint shows the core's default, never a number of its own (DECISIONS.md#d-116)", () => {
  for (const messages of [base, esBase]) {
    const hint = messages["routines.maxStepsHint"] ?? "";
    assert.match(hint, /\{steps\}/);
    assert.doesNotMatch(hint.replace("5", "").replace("200", ""), /\d/);
  }
});

test("the memory hint shows the desktop's idle tab time, never a number of its own", () => {
  for (const messages of [base, esBase]) {
    const hint = messages["desktop.memoryHint"] ?? "";
    assert.match(hint, /\{minutes\}/);
    assert.doesNotMatch(hint.replace("4 GB", ""), /\d/);
  }
});
