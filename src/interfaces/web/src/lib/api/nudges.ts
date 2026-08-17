import { http } from "../http";

export type NudgePolicy = {
  enabled: boolean;
  daily_max: number;
  quiet_hours: string;
  cooldown_minutes: number;
  project_cooldown_minutes: number;
  kind_cooldown_minutes: number;
  critical_bypasses_budget: boolean;
};

export type NudgeEntry = {
  id: string;
  at: string;
  kind: string;
  project_id: string | null;
  severity: string;
  channel: string;
  chat_id: string | null;
  preview: string;
  bypassed_budget: boolean;
  feedback: { useful: boolean; note: string; at: string } | null;
};

export type NudgeStats = {
  total: number;
  today: number;
  rated: number;
  by_kind: { kind: string; sent: number; useful: number; noise: number }[];
};

export const NudgesApi = {
  list: (limit = 50) =>
    http.get<{ data: NudgeEntry[]; meta: { total: number; stats: NudgeStats } }>(
      `/api/nudges?limit=${limit}`,
    ),
  policy: () =>
    http.get<{
      policy: NudgePolicy;
      /** Which layers contributed: defaults → profile → user. */
      source: string[];
      defaults: NudgePolicy;
      user_overrides: Partial<NudgePolicy>;
    }>("/api/nudges/policy"),
  setPolicy: (values: Partial<NudgePolicy>) =>
    http.put<{ ok: true; policy: NudgePolicy; source: string[] }>("/api/nudges/policy", values),
  feedback: (id: string, useful: boolean, note = "") =>
    http.post<{ ok: true; entry: NudgeEntry }>(
      `/api/nudges/${encodeURIComponent(id)}/feedback`,
      { useful, note },
    ),
};
