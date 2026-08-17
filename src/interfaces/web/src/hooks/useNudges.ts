import useSWR from "swr";
import { NudgesApi } from "../lib/api/nudges";
import type { NudgeEntry, NudgePolicy, NudgeStats } from "../lib/api/nudges";

/** The ledger of unrequested messages, plus what they add up to. */
export function useNudges(limit = 50) {
  const { data, error, isLoading, mutate } = useSWR<{
    data: NudgeEntry[];
    meta: { total: number; stats: NudgeStats };
  }>(`/api/nudges?limit=${limit}`, () => NudgesApi.list(limit));

  return {
    entries: data?.data ?? [],
    stats: data?.meta?.stats,
    error,
    isLoading,
    mutate,
  };
}

/** The effective budget, and which layer set each part of it. */
export function useNudgePolicy() {
  const { data, error, isLoading, mutate } = useSWR<{
    policy: NudgePolicy;
    source: string[];
    defaults: NudgePolicy;
    user_overrides: Partial<NudgePolicy>;
  }>("/api/nudges/policy", () => NudgesApi.policy());

  return {
    policy: data?.policy,
    source: data?.source ?? [],
    userOverrides: data?.user_overrides ?? {},
    error,
    isLoading,
    mutate,
  };
}
