// The agent editor's working copy: what the owner changed, saved together with one Save.
import {
  type Agent,
  type AgentRules,
  AUTONOMY_RULES,
  type Autonomy,
  type RulePolicy,
  type ToolRisk,
} from "@apx/protocol";

export type Draft = {
  name: string;
  role: string;
  area: string;
  description: string;
  personality: string;
  blob: string;
  prompt: string;
  /** Empty: every tool (or skill), as an agent without a list. */
  tools: string[];
  skills: string[];
  orchestrator: boolean;
  /** "": none of its own, the project's. */
  autonomy: Autonomy | "";
  /** Empty: none of its own, its autonomy decides every case. */
  rules: AgentRules;
  parent: string;
  browser_profile: Agent["browser_profile"];
};

/** A grant's pending change, keyed by `grantId`. */
export type GrantChange = { revoke?: boolean; condition?: string; expires_at?: string };
export const grantId = (key: string, agent?: string) => `${key}|${agent ?? ""}`;

export const PAGES = [
  "identity",
  "prompt",
  "team",
  "profile",
  "tools",
  "skills",
  "autonomy",
  "rules",
  "granted",
  "browser",
  "computer",
] as const;
export type PageId = (typeof PAGES)[number];

export const RISKS: readonly ToolRisk[] = ["read", "write", "outside", "irreversible"];
export const POLICIES: readonly RulePolicy[] = ["auto", "ask", "off"];

/** The rule each case follows: its own, else what its autonomy (or the project's) amounts to. */
export const effectiveRule = (d: Draft, project: Autonomy, risk: ToolRisk): RulePolicy =>
  d.rules[risk] ?? AUTONOMY_RULES[d.autonomy || project][risk];

/**
 * Leaving the project's mode for a rule of its own: the agent keeps that mode as its own and only the changed case
 * gets a rule, so every other case acts as the core runs that mode (DECISIONS.md#d-090).
 */
export const leaveProject = (
  project: Autonomy,
  risk: ToolRisk,
  policy: RulePolicy,
): Pick<Draft, "autonomy" | "rules"> => ({
  autonomy: project,
  rules: { [risk]: policy },
});

/** Back to the project's: no mode and no rules of its own. */
export const backToProject: Pick<Draft, "autonomy" | "rules"> = { autonomy: "", rules: {} };

export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
