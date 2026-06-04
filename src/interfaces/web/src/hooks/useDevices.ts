import useSWR from "swr";
import { Pair } from "../lib/api";
import { REFRESH } from "../constants";

export function useDevices() {
  const { data, error, isLoading, mutate } = useSWR(
    "/pair/list",
    () => Pair.list(),
    { refreshInterval: REFRESH.pairList },
  );
  return { clients: data?.clients || [], error, isLoading, mutate };
}
