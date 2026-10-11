// What the owner chose so far in the setup, before each step saves it.
import type { CatalogEngine, MemorySettings } from "@apx/protocol";
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
  /** The base project's name and kind (it may stay "Default"); read in once from the install. */
  baseName: string;
  baseKind: string;
  baseSet: boolean;
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
  baseName: "Default",
  baseKind: "",
  baseSet: false,
});

export type StepProps = { draft: Draft; set: (p: Partial<Draft>) => void };

/** "gemini/gemini-2.5-flash#high" → "gemini". */
const engineOf = (ref: string) => ref.split(/[/#]/)[0] ?? ref;

/**
 * The chain with each of these providers' everyday model at the end, for the ones it has none of yet; also which
 * providers are still waiting for the catalog to name theirs.
 */
export function withStarters(
  chain: readonly string[],
  providers: readonly string[],
  catalog: readonly CatalogEngine[],
): { chain: string[]; waiting: string[] } {
  const out = [...chain];
  const waiting: string[] = [];
  for (const id of providers) {
    if (out.some((ref) => engineOf(ref) === id)) continue;
    const starter = catalog.find((e) => e.id === id && e.available)?.starter;
    if (starter) out.push(`${id}/${starter}`);
    else waiting.push(id);
  }
  return { chain: out, waiting };
}
