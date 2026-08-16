import useSWR from "swr";
import { ProfilesApi } from "../lib/api/profiles";
import type { ProfileDetail, ProfileDoctor, ProfileSummary } from "../lib/api/profiles";

/** The catalogue of agent profiles, plus which one is active. */
export function useProfiles() {
  const { data, error, isLoading, mutate } = useSWR<{
    active: string | null;
    profiles: ProfileSummary[];
  }>("/profiles", () => ProfilesApi.list());

  return {
    active: data?.active ?? null,
    profiles: data?.profiles ?? [],
    error,
    isLoading,
    mutate,
  };
}

/** One profile, including its schema, settings and rendered prompt preview. */
export function useProfile(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<ProfileDetail>(
    id ? `/profiles/${id}` : null,
    () => ProfilesApi.get(id as string),
  );
  return { profile: data, error, isLoading, mutate };
}

/** Health of the active profile (or a named one). */
export function useProfileDoctor(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<ProfileDoctor>(
    id ? `/profiles/doctor?id=${id}` : "/profiles/doctor",
    () => ProfilesApi.doctor(id || undefined),
  );
  return { doctor: data, error, isLoading, mutate };
}
