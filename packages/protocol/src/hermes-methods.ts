// Moving from Hermes: what a Hermes home folder holds, as APX would take it (preview), and taking it (import). The
// import does exactly what the preview listed; a second import of the same folder changes nothing.
import { z } from "zod";

export const HermesItem = z.object({
  kind: z.enum(["agent", "note", "skill", "routine", "server", "setting"]),
  /** The Hermes profile it is in ("default" for the home folder itself). */
  profile: z.string(),
  name: z.string(),
  action: z.enum(["add", "update", "skip"]),
  /**
   * Why it is skipped, or what to know about what is added: `same` already in APX as it is; `taken` APX has something
   * else of that name; `removed` it was imported before and the owner removed it in APX; `secret` it holds a
   * credential, never copied (`detail` names it); `off` it comes turned off; `none` APX has no place for it; `invalid`
   * APX cannot take it as it is; `refused` APX refused it on import (`detail` says why).
   */
  why: z.enum(["same", "taken", "removed", "secret", "off", "none", "invalid", "refused"]).optional(),
  detail: z.string().optional(),
});
export type HermesItem = z.infer<typeof HermesItem>;

const HermesSource = z.object({ path: z.string().min(1).max(1000) }).strict();

export const hermesMethods = {
  /** What importing a Hermes home folder (~/.hermes) would add, update or skip, and why. Reads it only. */
  "hermes.preview": {
    params: HermesSource,
    result: z.object({ items: z.array(HermesItem) }),
    effect: false,
    access: "human",
  },
  /**
   * Imports what the preview lists: each profile an agent, its memory as notes, its skills, its cron jobs as routines
   * turned off, its MCP servers (with secret:// references left empty, and off). A secret it finds is never copied.
   */
  "hermes.import": {
    params: HermesSource,
    result: z.object({ items: z.array(HermesItem) }),
    effect: true,
    access: "human",
  },
} as const;
