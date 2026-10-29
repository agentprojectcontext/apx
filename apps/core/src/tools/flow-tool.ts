// apx_flow: the super-agent reads, draws and fills the owner's Flows and their project tables. They are the owner's work,
// like routines and tasks, not their settings, so they have a tool of their own (DECISIONS.md#d-181). A new Flow or
// table method, step kind or field reaches agents here and in the apx-flows skill: rules/FLOWS.md#agents-reach-it.
import type { Store } from "../domain/store.ts";
import { FLOWS } from "./flow-tool-flows.ts";
import { TABLES } from "./flow-tool-tables.ts";
import { areaTool } from "./settings.ts";
import type { Setting } from "./settings-kit.ts";
import type { Tool } from "./types.ts";

export const FLOW_TOOL = "apx_flow";

/** What the super-agent may read and change in Flows and tables, by method. */
export const FLOW_SETTINGS: Readonly<Record<string, Setting>> = { ...FLOWS, ...TABLES };

/** The area a method belongs to, as its card's title names it ("Changed a Flow"). */
const AREA: Readonly<Record<string, string>> = { flows: "a Flow", tables: "a table" };

export function flowTools(store: Store): Tool[] {
  return [
    areaTool(
      {
        name: FLOW_TOOL,
        description:
          "Read, draw and change the owner's Flows (a webhook or schedule that runs checks, tables, code, an AI model, a message or a request) and their projects' tables. No args: the areas; method: an area's methods, or a method's fields; method + params: run it. Step fields: load_skill \"apx-flows\".",
        table: FLOW_SETTINGS,
        areas: AREA,
        looked: "Looked at the Flows",
        elsewhere:
          "Drafts save freely and run nothing; publishing, running by hand, tests and a Flow's address stay the owner's, in the Flows editor.",
      },
      { store, profiles: [], templates: [] },
    ),
  ];
}
