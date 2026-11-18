import { createStore, useSlice } from "../data/createStore.ts";

type PublicRequest = {
  surface?: string;
  code?: string;
  draft?: string;
  input?: string;
  action: "publish" | "update" | "revoke";
};
const request = createStore<{ value?: PublicRequest }>({});
export const openPublicCopy = (value: PublicRequest): void => request.set({ value });
export const closePublicCopy = (): void => request.set({ value: undefined });
export const usePublicRequest = (): PublicRequest | undefined => useSlice(request, (state) => state.value);
