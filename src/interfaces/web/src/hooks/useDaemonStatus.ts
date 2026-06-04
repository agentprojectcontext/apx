import useSWR from "swr";
import { Health } from "../lib/api";
import { REFRESH } from "../constants";

export function useDaemonStatus() {
  const { data, error, isLoading } = useSWR(
    "/health",
    () => Health.get(),
    { refreshInterval: REFRESH.health },
  );
  return { health: data, error, isLoading, isUp: !error && !!data };
}
