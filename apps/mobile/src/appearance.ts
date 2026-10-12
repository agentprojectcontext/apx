// The look picked in Settings, kept on this phone: the system's, or always light or dark.
import * as SecureStore from "expo-secure-store";
import { Appearance } from "react-native";

export type AppearancePref = "system" | "light" | "dark";

const KEY = "apx.appearance";

const apply = (pref: AppearancePref) => Appearance.setColorScheme(pref === "system" ? "unspecified" : pref);

export async function loadAppearance(): Promise<AppearancePref> {
  const raw = await SecureStore.getItemAsync(KEY).catch(() => null);
  const pref: AppearancePref = raw === "light" || raw === "dark" ? raw : "system";
  apply(pref);
  return pref;
}

export async function saveAppearance(pref: AppearancePref): Promise<void> {
  apply(pref);
  await SecureStore.setItemAsync(KEY, pref);
}
