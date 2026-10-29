// A Flow's address and the owner's tests of it with a real event (DECISIONS.md#d-178). Owner-only, like running and
// stopping a Flow: a test sends, calls, runs and writes for real.
import { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { FlowCapacityError } from "../domain/flow-events.ts";
import { isFlowTrigger } from "../domain/flow-graph-validate.ts";
import { FlowGraphConflict, FlowTriggerMismatch } from "../domain/flow-graphs.ts";
import { FlowPathError } from "../domain/flows.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, CallError, conflict, notFound } from "../errors.ts";
import { type FlowModelCheck, type Flows, flowDraftIssues } from "../flows.ts";
import type { PublicCredentials } from "../public-credentials.ts";
import { cantRun, checkOutward, pathRefused } from "./flow-graphs.ts";
import type { Handlers } from "./router.ts";

export function flowTestHandlers(store: Store, flows: Flows, credentials: PublicCredentials, model: FlowModelCheck) {
  const found = (id: string) => {
    const flow = store.flows.get(id);
    if (!flow) throw notFound("Flow not found");
    return flow;
  };
  return {
    "flows.path_check": ({ path, flow }) => store.flows.pathCheck(path, flow),
    "flows.token": ({ flow }) => {
      const definition = found(flow);
      return credentials.reveal(`/flows/${definition.path ?? definition.id}`);
    },
    "flows.token_rotate": ({ flow, token }) => {
      const definition = found(flow);
      const doc = store.flowGraphs.get(flow);
      // A schedule Flow has no address, so no key: its drawing (saved or what runs) starts on a schedule.
      if ((doc.draft ?? doc.published)?.nodes.some((n) => n.kind === "schedule"))
        throw conflict("A flow that runs on a schedule has no address to protect");
      const path = `/flows/${definition.path ?? definition.id}`;
      credentials.issue(path, token);
      return credentials.reveal(path);
    },
    "flows.path_set": ({ flow, path }) => {
      const before = found(flow);
      try {
        return store.tx(() => {
          const saved = store.flows.setPath(flow, path);
          if (!saved) throw notFound("Flow not found");
          // The key goes with the address; the old one answers nothing from now on.
          credentials.move(`/flows/${before.path ?? flow}`, `/flows/${path}`);
          return saved;
        });
      } catch (error) {
        if (error instanceof FlowPathError) throw pathRefused(error);
        throw error;
      }
    },
    "flows.test_start": ({ flow, expectedDraftVersion, outward }) => {
      const definition = found(flow);
      const doc = store.flowGraphs.get(flow);
      if (doc.draftVersion !== expectedDraftVersion) throw conflict("The drawing changed; save it again to test it");
      const drawn = doc.draft ?? doc.published;
      if (!drawn) throw conflict("Save the drawing before testing it");
      const issues = flowDraftIssues(store, definition, drawn, model, flows.outside);
      if (issues.length) throw cantRun(issues);
      const graph = FlowGraph.parse(drawn);
      checkOutward(store, flows.outside, definition.projectId, graph, outward);
      try {
        const revision = store.flowGraphs.testRevision(flow, graph);
        const text = JSON.stringify(graph);
        if (graph.nodes.find(isFlowTrigger)?.kind === "schedule")
          return { listening: null, event: flows.tests.runNow(flow, revision, text) };
        const until = flows.tests.listen(flow, revision, text);
        return {
          listening: { until: until.toISOString(), path: `/flows/test/${definition.path ?? flow}` },
          event: null,
        };
      } catch (error) {
        if (error instanceof CallError) throw error;
        if (error instanceof FlowCapacityError) throw conflict("This flow has too many runs waiting");
        if (error instanceof FlowTriggerMismatch || error instanceof FlowGraphConflict)
          throw conflict("The drawing can't be tested as it is: open it in the editor");
        throw badRequest("The drawing can't be tested as it is");
      }
    },
    "flows.test_stop": ({ flow }) => {
      found(flow);
      return { stopped: flows.tests.stop(flow) };
    },
  } satisfies Partial<Handlers>;
}
