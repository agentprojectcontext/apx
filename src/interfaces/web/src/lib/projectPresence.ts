// Why a project's folder could not be read, in the reader's language.
//
// The daemon answers with a sentence, not a code — the same sentence the CLI
// prints — so pasting it straight into the panel leaves "the folder no longer
// exists" sitting inside a Spanish paragraph. There are exactly two answers it
// can give (see core/apc/project-presence.js) and they are worth telling apart:
// a folder that is GONE probably moved and can be searched for, while a folder
// that is still there without `.apc/project.json` was de-initialized and
// searching for it would find nothing.
//
// Anything unrecognised falls through verbatim: a reason we cannot translate is
// still worth more than a shrug, and this is the screen where it matters.
import { t } from "../i18n";

export function missingReasonText(reason?: string | null): string {
  if (!reason) return t("nav.missing_folder");
  if (/no longer exists/i.test(reason)) return t("project.folder.reason_gone");
  if (/project\.json/i.test(reason)) return t("project.folder.reason_deinit");
  return reason;
}
