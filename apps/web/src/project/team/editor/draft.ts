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

export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
