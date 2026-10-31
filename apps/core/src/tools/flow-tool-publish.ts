// apx_flow's publishing and running: when the owner asks in the chat, the super-agent makes a Flow's draft what runs
// and starts it by hand, each once the owner approves a card that says what it will send, call, run and change, as the
// editor asks before it publishes (DECISIONS.md#d-184).
import type { Result } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { flowOutward } from "../flow-outward.ts";
import { inlineName } from "./result.ts";
import { type Params, quoted, type Setting, type SettingsDeps, str } from "./settings-kit.ts";

const english = (store: Store) => store.settings.get("owner_language") === "en";
const flowName = (store: Store, id: unknown) => {
  const name = store.flows.get(str(id))?.name ?? str(id);
  return english(store) ? inlineName(name) : `«${name}»`;
};

/** What a drawing does as the owner, one line each in the owner's language, as the editor shows it before publishing. */
function outwardLines(store: Store, flow: string): string[] {
  const draft = store.flowGraphs.get(flow).draft;
  if (!draft) return [];
  const { sends, calls, commands, writes } = flowOutward(store, draft);
  const en = english(store);
  const keys = (names: string[]) =>
    !names.length ? "" : en ? ` with ${names.join(", ")}` : ` con ${names.join(", ")}`;
  const agents = draft.nodes.filter((n) => n.kind === "agent");
  return en
    ? [
        ...sends.map((s) => `• Sends ${s.owner ? "you" : s.to} a message on ${s.channel}`),
        ...calls.map((c) => `• Calls ${c.host} (${c.method})${keys(c.secrets)}`),
        ...commands.map((c) => `• Runs \`${c.command}\` on this computer${keys(c.secrets)}`),
        ...writes.map((w) => `• Changes the database ${w.database}`),
        ...agents.map((n) => `• An agent acts in the step ${quoted(n.label, 60)}`),
      ]
    : [
        ...sends.map((s) => `• ${s.owner ? "Te manda" : `Le manda a ${s.to}`} un mensaje por ${s.channel}`),
        ...calls.map((c) => `• Llama a ${c.host} (${c.method})${keys(c.secrets)}`),
        ...commands.map((c) => `• Corre \`${c.command}\` en esta computadora${keys(c.secrets)}`),
        ...writes.map((w) => `• Cambia la base de datos ${w.database}`),
        ...agents.map((n) => `• Un agente actúa en el paso «${n.label.slice(0, 60)}»`),
      ];
}

/** Sample data as the owner reads it: one line per field, nested values as they came. */
function dataLines(store: Store, v: unknown): string {
  const head = english(store) ? "With this data:" : "Con estos datos:";
  if (!v || typeof v !== "object" || Array.isArray(v) || !Object.keys(v).length)
    return `${head} ${v === undefined || (typeof v === "object" && v && !Object.keys(v).length) ? (english(store) ? "none" : "ninguno") : JSON.stringify(v)}`;
  const lines = Object.entries(v).map(([k, x]) => `  ${k}: ${typeof x === "string" ? x : JSON.stringify(x)}`);
  return [head, ...lines].join("\n");
}

/** Why a draft can't be published as the agent named it, before anyone is asked. */
function publishRefused(p: Params, { store }: SettingsDeps): string | undefined {
  if (!store.flows.get(str(p.flow))) return "no such Flow: flows.list names them";
  const doc = store.flowGraphs.get(str(p.flow));
  if (!doc.draft || doc.draftVersion === null) return "nothing new to publish: what runs is already its drawing";
  if (doc.draftVersion !== p.expectedDraftVersion)
    return `the draft is at version ${doc.draftVersion}: read it again (flows.graph_get) before asking`;
  return undefined;
}

export const FLOW_PUBLISH: Readonly<Record<string, Setting>> = {
  "flows.publish": {
    does: "make a Flow's draft what runs and turn the Flow on, once the owner approves the card (flow, expectedDraftVersion from your last save). Validate first; only when the owner asks you to turn it on",
    keep: (p, { store }) => ({
      flow: str(p.flow),
      expectedDraftVersion: p.expectedDraftVersion,
      expectedPublishedRevision: store.flowGraphs.get(str(p.flow)).publishedRevision,
    }),
    refuse: publishRefused,
    says: (p, { store }) => {
      const name = flowName(store, p.flow);
      const lines = outwardLines(store, str(p.flow));
      const head = english(store)
        ? `Turn on ${name}. From now on it runs as drawn each time it is triggered.`
        : `Prender ${name}. Desde ahora corre como está dibujado cada vez que se dispare.`;
      if (!lines.length) return head;
      return [head, english(store) ? "Each time, it:" : "Cada vez:", ...lines].join("\n");
    },
    named: ["flow", "expectedDraftVersion", "expectedPublishedRevision"],
    owner: async (p, { store }, call) => {
      const flow = str(p.flow);
      const doc = await call("flows.graph_get", { flow });
      if (!doc.draft || doc.draftVersion === null || doc.draftVersion !== p.expectedDraftVersion)
        return "not published: the draft changed after the owner was asked. Read it again and ask again";
      const { keys } = await call("flows.outward", { flow, graph: doc.draft });
      const out = await call("flows.publish", {
        flow,
        expectedDraftVersion: doc.draftVersion,
        expectedPublishedRevision: doc.publishedRevision,
        outward: keys,
      });
      const def = store.flows.get(flow);
      if (def && !def.enabled) await call("flows.set", { ...def, enabled: true });
      return `done: version ${out.publishedRevision} of ${inlineName(def?.name ?? flow)} runs and the Flow is on. To try it now: flows.run_now {flow, data}.`;
    },
  },
  "flows.run_now": {
    does: "start a Flow that is on now, as its trigger would (flow; data: a webhook's sample body, untrusted like any), once the owner approves the card; then read it with flows.run_get. This is how to try one: never ask for its key",
    refuse: (p, { store }) => {
      const def = store.flows.get(str(p.flow));
      if (!def) return "no such Flow: flows.list names them";
      return def.enabled ? undefined : "it is off: publish it first (flows.publish turns it on)";
    },
    says: (p, { store }) =>
      english(store)
        ? `Try ${flowName(store, p.flow)} now. It runs for real: it sends, calls and changes what it does when triggered.`
        : `Probar ${flowName(store, p.flow)} ahora. Corre de verdad: manda, llama y cambia lo mismo que cuando se dispara.`,
    named: ["flow"],
    words: { data: (v, { store }) => dataLines(store, v) },
    whole: true,
    shows: (r) => {
      const { event, state } = r as Result<"flows.run_now">;
      return state === "pending"
        ? `started, event ${event}: read its steps with flows.run_get {flow, event}`
        : `not started (${state === "duplicate" ? "an event with that id already ran" : "its trigger did not take this data"})`;
    },
  },
};
