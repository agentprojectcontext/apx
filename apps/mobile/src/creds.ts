// The core this phone is paired with and its own key, in the system's secure storage (Keychain, Keystore).
import * as SecureStore from "expo-secure-store";

export type Creds = { url: string; token: string; device: string };

const KEY = "apx.pairing";

export async function loadCreds(): Promise<Creds | undefined> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return undefined;
    const c = value as Partial<Creds>;
    if (
      typeof c.url !== "string" ||
      !c.url ||
      typeof c.token !== "string" ||
      !c.token ||
      typeof c.device !== "string" ||
      !c.device
    )
      return undefined;
    return { url: c.url, token: c.token, device: c.device };
  } catch {
    return undefined;
  }
}

export const saveCreds = (c: Creds) => SecureStore.setItemAsync(KEY, JSON.stringify(c));
export const clearCreds = () => SecureStore.deleteItemAsync(KEY);
