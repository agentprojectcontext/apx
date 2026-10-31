// apx_flow's publishing and running: when the owner asks in the chat, the super-agent makes a Flow's draft what runs
// and starts it by hand, each once the owner approves a card that says what it will send, call, run and change, as the
// editor asks before it publishes (DECISIONS.md#d-184).
import type { Result } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { flowOutward } from "../flow-outward.ts";
import { inlineName } from "./result.ts";
import { type Params, quoted, type Setting, type SettingsDeps, str } from "./settings-kit.ts";

const flowName = (store: Store, id: unknown) => inlineName(store.flows.get(str(id))?.name ?? str(id));

/** What a drawing does as the owner, one line each, as the editor shows it before publishing. */
function outwardLines(store: Store, flow: string): string[] {
  const draft = store.flowGraphs.get(flow).draft;
  if (!draft) return [];
  const { sends, calls, commands, writes } = flowOutward(store, draft);
  const secrets = (names: string[]) => (names.length ? ` with ${names.join(", ")}` : "");
  return [
    ...sends.map((s) => `Sends a message to ${s.owner ? "you" : s.to} on ${s.channel}`),
    ...calls.map((c) => `Calls ${c.method} ${c.host}${secrets(c.secrets)}`),
    ...commands.map((c) => `Runs \`${c.command}\` on this computer${secrets(c.secrets)}`),
    ...writes.map((w) => `Changes the database ${w.database}`),
    ...draft.nodes
      .filter((n) => n.kind === "agent")
      .map((n) => `Its step ${quoted(n.label, 60)} has an agent act on it`),
  ];
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
    says: (p, { store }) =>
      [
        `Publish ${flowName(store, p.flow)} and turn it on: each time it is triggered it runs as drawn.`,
        ...outwardLines(store, str(p.flow)),
      ].join("\n"),
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
      return `done: version ${out.publishedRevision} of ${flowName(store, flow)} runs and the Flow is on. To try it now: flows.run_now {flow, data}.`;
    },
  },
  "flows.run_now": {
    does: "start a Flow that is on now, as its trigger would (flow; data: a webhook's sample body, untrusted like any), once the owner approves the card; then read it with flows.run_get. This is how to try one: never ask for its key",
    refuse: (p, { store }) => {
      const def = store.flows.get(str(p.flow));
      if (!def) return "no such Flow: flows.list names them";
      return def.enabled ? undefined : "it is off: publish it first (flows.publish turns it on)";
    },
    says: (p, { store }) => `Run ${flowName(store, p.flow)} now: it sends, calls and runs what it does when triggered.`,
    named: ["flow"],
    words: { data: (v) => `With this data: ${JSON.stringify(v ?? {})}` },
    whole: true,
    shows: (r) => {
      const { event, state } = r as Result<"flows.run_now">;
      return state === "pending"
        ? `started, event ${event}: read its steps with flows.run_get {flow, event}`
        : `not started (${state === "duplicate" ? "an event with that id already ran" : "its trigger did not take this data"})`;
    },
  },
};
