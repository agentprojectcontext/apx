import assert from "node:assert/strict";
import { test } from "node:test";
import { enComputer } from "./computer-en.ts";
import { esComputer } from "./computer-es.ts";
import { en as base } from "./en.ts";
import { enEmailSignatures } from "./en-email-signatures.ts";
import { es as esBase } from "./es.ts";
import { esEmailSignatures } from "./es-email-signatures.ts";
import { enFlow } from "./flow-en.ts";
import { esFlow } from "./flow-es.ts";
import { enIngress } from "./ingress-en.ts";
import { esIngress } from "./ingress-es.ts";
import { enReceived } from "./received-en.ts";
import { esReceived } from "./received-es.ts";
import { enSysUsage } from "./sysusage-en.ts";
import { esSysUsage } from "./sysusage-es.ts";
import { enThreadDialogs } from "./thread-dialogs-en.ts";
import { esThreadDialogs } from "./thread-dialogs-es.ts";

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

// A pack's strings belong to the language as much as the main chunk's.
const en = {
  ...base,
  ...enComputer,
  ...enReceived,
  ...enSysUsage,
  ...enEmailSignatures,
  ...enThreadDialogs,
  ...enIngress,
  ...enFlow,
};
const es = {
  ...esBase,
  ...esComputer,
  ...esReceived,
  ...esSysUsage,
  ...esEmailSignatures,
  ...esThreadDialogs,
  ...esIngress,
  ...esFlow,
};

// Each language is loaded alone, so a key it lacks would show as the bare key.
test("every English text has its Spanish translation", () => {
  const missing = Object.keys(en).filter((k) => (es as Record<string, string | undefined>)[k] === undefined);
  assert.deepEqual(missing, []);
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
