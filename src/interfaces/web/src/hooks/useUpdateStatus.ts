import useSWR from "swr";
import { Update } from "../lib/api";

/**
 * "Is there a newer APX than the one running?" — asked once for the whole panel.
 *
 * Three surfaces ask now: the card in the corner, the badge on the settings
 * gear, and the offer at the foot of the settings nav. They share one SWR key,
 * so they make ONE request between them and can never contradict each other —
 * a gear with a badge over a settings screen that offers nothing is worse than
 * no badge at all.
 *
 * `newer` is deliberately false in a git checkout. There the running version is
 * whatever the working tree says, npm's `latest` is behind it as often as
 * ahead, and `apx update` replaces a global npm install — the wrong thing to do
 * to a clone. Every caller can then just read `newer` without each one
 * remembering the rule.
 */
export const UPDATE_CMD = "apx update";

export function useUpdateStatus() {
  const { data } = useSWR("update", () => Update.get(), {
    refreshInterval: 60 * 60_000,
    revalidateOnFocus: false,
  });

  const newer = !!data?.newer && !!data.latest && !data.from_git;
  return {
    status: data,
    newer,
    current: data?.current ?? null,
    latest: data?.latest ?? null,
  };
}
