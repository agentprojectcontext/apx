import { useEffect } from "react";
import { client } from "../data/client.ts";
import { createStore, useSlice } from "../data/createStore.ts";

// The owner's public copies, read once and again whenever one is published, updated or stopped: each artifact's Share
// menu shows its own (by the local artifact it came from). Listing reads the cloud, so it is not read per menu.
type Copy = { code: string; url: string; surface?: string | undefined };
const copies = createStore<{ items: readonly Copy[] }>({ items: [] });
let loading: Promise<void> | undefined;
let listening = false;

export function loadPublicCopies(again = false): Promise<void> {
  if (!listening) {
    listening = true;
    window.addEventListener("apx-public-copies-changed", () => void loadPublicCopies(true));
  }
  if (loading && !again) return loading;
  // Signed out (or offline) there is nothing to show; the menu still offers to publish.
  const list = async (): Promise<readonly Copy[]> =>
    (await client.call("account.get", {})).profile ? (await client.call("surfaces.public_list", {})).items : [];
  loading = list().then(
    (items) => copies.set({ items }),
    () => copies.set({ items: [] }),
  );
  return loading;
}

/** The local artifact a public copy of the owner's was published from, once the list is read. */
export async function sourceOfPublicCopy(code: string): Promise<string | undefined> {
  await loadPublicCopies();
  return copies.get().items.find((item) => item.code === code)?.surface;
}

/** The public copy published from this artifact, if any. */
export const publicCopyOf = (surface: string): Copy | undefined =>
  copies.get().items.find((item) => item.surface === surface);

export function usePublicCopyOf(surface: string): Copy | undefined {
  useEffect(() => {
    void loadPublicCopies();
  }, []);
  return useSlice(copies, (state) => state.items.find((item) => item.surface === surface));
}

/** The artifact whose live link (from this computer) the owner is about to turn on. */
const liveLink = createStore<{ surface?: string }>({});
export const openLiveLink = (surface: string): void => liveLink.set({ surface });
export const closeLiveLink = (): void => liveLink.set({ surface: undefined });
export const useLiveLinkRequest = (): string | undefined => useSlice(liveLink, (state) => state.surface);
