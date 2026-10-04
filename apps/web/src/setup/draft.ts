// What the owner chose so far in the setup, before each step saves it.
import type { MemorySettings } from "@apx/protocol";
import type { V1Group } from "../data/setup.ts";

export type Draft = {
  mode: "new" | "import";
  name: string;
  blob: string;
  /** The super-agent's current name and face were read in once. */
  nameSet: boolean;
  /** Engines in order: the first is the default, the rest its fallbacks. */
  chain: string[];
  chainSet: boolean;
  memory: MemorySettings["mode"];
  compact: boolean;
  /** Each message picks its skills by meaning (needs an embedding engine). */
  skillPicker: boolean;
  importOn: Partial<Record<V1Group, boolean>>;
  projectChoice: "folder" | "later";
  path: string;
};

export const defaultDraft = (): Draft => ({
  mode: "new",
  name: "",
  blob: "",
  nameSet: false,
  chain: [],
  chainSet: false,
  memory: "notes",
  compact: true,
  skillPicker: true,
  importOn: {},
  projectChoice: "folder",
  path: "",
});

export type StepProps = { draft: Draft; set: (p: Partial<Draft>) => void };
