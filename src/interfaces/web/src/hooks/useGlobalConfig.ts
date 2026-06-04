import useSWR from "swr";
import { Admin } from "../lib/api";
import type { GlobalConfig, SuperAgentConfig } from "../types/daemon";

export function useGlobalConfig() {
  const { data, error, isLoading, mutate } = useSWR(
    "/admin/config",
    () => Admin.config.get(),
  );
  const patch = async (set?: Record<string, unknown>, unset?: string[]) => {
    const next = await Admin.config.patch({ set, unset });
    await mutate({ config: next.config }, { revalidate: false });
    return next.config;
  };
  return { config: (data?.config || {}) as GlobalConfig, error, isLoading, mutate, patch };
}

export function useSuperAgentConfig() {
  const { data, error, isLoading, mutate } = useSWR(
    "/admin/super-agent",
    () => Admin.superAgent(),
  );
  return { superAgent: data as SuperAgentConfig | undefined, error, isLoading, mutate };
}
