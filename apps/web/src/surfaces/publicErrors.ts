import type { MessageKey } from "../i18n/index.ts";

export function publicError(error: unknown): MessageKey {
  const message = error instanceof Error ? error.message : String(error);
  if (/sign_in|account_not_configured/.test(message)) return "public.signIn";
  if (/source_changed|account_changed|preview_expired|state_changed|artifact_changed|source_missing/.test(message))
    return "public.invalid";
  if (/artifact_limit/.test(message)) return "public.limit";
  if (/html_too_large/.test(message)) return "public.htmlLarge";
  if (/too_large/.test(message)) return "public.large";
  if (/code_unavailable/.test(message)) return "public.codeBusy";
  if (/review_required/.test(message)) return "public.reviewRequired";
  if (/secret_reference/.test(message)) return "public.secret";
  return "public.connection";
}
