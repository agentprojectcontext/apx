import useSWR from "swr";
import { Engines } from "../lib/api";

export function useEngines() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/engines",
    () => Engines.list(),
  );
  return { engines: data?.engines || [], error, isLoading, mutate };
}
