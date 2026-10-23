// The super-agent's profile (profiles.*): one copy for every screen that shows or switches it, so Settings, the
// super-agent's editor and its card stay in step.
import type { Localized, Result } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { notify } from "./notices.ts";
import { loadRoutines, routinesLoaded } from "./routines.ts";

export type ProfilesState = Result<"profiles.list">;
export type ProfileValue = string | number;

/** `profiles` undefined: not read yet; `failed`: the core refused the read. */
export type ProfilesStore = { profiles?: ProfilesState; failed: boolean };
const store = createStore<ProfilesStore>({ failed: false });

export const useProfiles = <T>(select: (s: ProfilesStore) => T): T => useSlice(store, select);

const fail = (e: unknown) => notify(t("error.profile", { error: e instanceof Error ? e.message : String(e) }));

/** `quiet`: a screen that only names the profile says nothing when the read fails. */
export async function loadProfiles({ quiet = false } = {}): Promise<void> {
  try {
    store.set({ profiles: await client.call("profiles.list", {}), failed: false });
  } catch (e) {
    store.set({ failed: true });
    if (!quiet) fail(e);
  }
}

/** The active profile's name in `lang`; null with none, undefined while it is not known yet. */
export function activeProfileName(s: ProfilesStore, lang: string): string | null | undefined {
  if (!s.profiles) return s.failed ? null : undefined;
  const { profiles, active } = s.profiles;
  const p = profiles.find((x) => x.id === active.id);
  return p ? localized(p.name, lang) : null;
}

export const localized = (l: Localized | undefined, lang: string): string => (l ? (l[lang] ?? l.en) : "");

/** Switches the profile (null: none) or saves its values; its routines are created, adopted or turned off. */
export async function setProfile(id: string | null, values: Record<string, ProfileValue>): Promise<void> {
  try {
    const r = await client.call("profiles.set", { id, values });
    store.set((s) => (s.profiles ? { profiles: { ...s.profiles, ...r } } : {}));
    if (routinesLoaded()) void loadRoutines();
  } catch (e) {
    fail(e);
  }
}

export const restoreProfileRoutine = (routine: string) =>
  client
    .call("profiles.restore", { routine })
    .then(() => loadProfiles())
    .catch(fail);

export const removeProfile = (id: string) =>
  client
    .call("profiles.remove", { id })
    .then(() => loadProfiles())
    .catch(fail);
