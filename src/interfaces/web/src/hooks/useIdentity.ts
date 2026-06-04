import useSWR from "swr";
import { IdentityApi } from "../lib/api/identity";
import type { Identity } from "../types/daemon";

export function useIdentity() {
  const { data, error, isLoading, mutate } = useSWR<Identity>(
    "/identity",
    () => IdentityApi.get(),
  );
  const save = async (patch: Partial<Identity>) => {
    const next = await IdentityApi.patch(patch);
    await mutate(next, { revalidate: false });
    return next;
  };
  return { identity: data || {}, error, isLoading, mutate, save };
}
