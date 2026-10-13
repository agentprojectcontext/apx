import * as Clipboard from "expo-clipboard";
import { t } from "../i18n";
import { flash } from "./Flash";

/** Puts the words on the clipboard and says so. */
export async function copyText(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
  flash(t("copied"));
}
