import type { Store } from "../domain/store.ts";
import { badRequest, notFound } from "../errors.ts";
import { type Flows, validateFlowBinding } from "../flows.ts";
import type { Handlers } from "./router.ts";

export function flowHandlers(store: Store, flows: Flows) {
  const found = (id: string) => {
    const flow = store.flows.get(id);
    if (!flow) throw notFound("Flow not found");
    return flow;
  };
  return {
    "flows.list": ({ project }) => ({ flows: store.flows.list(project) }),
    "flows.set": (flow) => {
      validateFlowBinding(store, flow);
      const previous = store.flows.get(flow.id);
      if (previous && previous.projectId !== flow.projectId) throw badRequest("Flow belongs to another project");
      try {
        const saved = store.flows.save(flow);
        flows.kick();
        return saved;
      } catch {
        throw badRequest("Invalid Flow definition or capacity exceeded");
      }
    },
    "flows.rows": ({ flow, limit }) => {
      found(flow);
      return { rows: store.flows.rows(flow, limit) };
    },
    "flows.write": ({ flow, key, value }) => {
      found(flow);
      try {
        return store.flows.write(flow, key, value);
      } catch {
        throw badRequest("Invalid Flow row or capacity exceeded");
      }
    },
    "flows.events": ({ flow, limit }) => {
      found(flow);
      return { events: store.flows.events(flow, limit) };
    },
    "flows.retry": ({ flow, event }) => {
      found(flow);
      const result = store.flows.retry(flow, event);
      flows.kick();
      return result;
    },
  } satisfies Partial<Handlers>;
}
