// The ChatGPT plan's sign-in for APX's own loop (chatgpt.*): status, a device code to type, or v1's sign-in taken over.
import type { ChatgptStatus } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { loadCatalog } from "./models.ts";
import { notify } from "./notices.ts";
import { loadProviders } from "./providers.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function chatgptStatus(): Promise<ChatgptStatus | undefined> {
  try {
    return await client.call("chatgpt.status", {});
  } catch {
    return undefined;
  }
}

/** Starts a sign-in (or takes v1's over); once signed in, the providers and the model catalog are read again. */
export async function chatgptConnect(via: "device" | "v1"): Promise<ChatgptStatus | undefined> {
  try {
    const s = await client.call("chatgpt.connect", { via });
    if (s.connected) await chatgptChanged();
    return s;
  } catch (e) {
    notify(t("error.change", { error: errText(e) }));
    return undefined;
  }
}

export async function chatgptDisconnect(): Promise<ChatgptStatus | undefined> {
  try {
    const s = await client.call("chatgpt.disconnect", {});
    await chatgptChanged();
    return s;
  } catch (e) {
    notify(t("error.change", { error: errText(e) }));
    return undefined;
  }
}

export async function chatgptChanged(): Promise<void> {
  await loadProviders();
  void loadCatalog(true);
}
